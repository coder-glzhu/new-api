// lucky_bag_real_sim — 基于线上真实数据的 100 次抽奖健康度仿真。
// 算法与 model/lucky_bag.go 保持完全一致（含最新改动）：
//   - calcUserScore: 累计消耗 > 充值总额 > 累计参与福袋 > 近7天消耗 > 邀请注册 > 累计签到
//   - 48h 内中奖者直接排除
//   - 非VIP权重 ×0.5（floor=1）
//   - 第1名只能是VIP（无VIP则空缺）
//   - 非VIP中奖额度上限压至区间中点
//
// 用法（需先在本机建好 SSH 隧道）:
//
//	ssh -L 15432:postgres:5432 aiproxy -N &
//	go run ./scripts/lucky_bag_real_sim/
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// ── 数据结构 ──────────────────────────────────────────────────────────────────

type User struct {
	ID       int
	Username string
	Group    string

	// calcUserScore 六个维度
	TotalQuota   int64   // 累计消耗 token（all-time）
	TotalRecharge int64  // 充值总额（top_ups.amount + subscription_orders.money*10000）
	LBEntries    int64   // 累计参与福袋次数
	WeekQuota    int64   // 近7天消耗 token
	InviteCount  int64   // 邀请注册人数
	CheckinCount int64   // 累计签到次数

	// 仿真运行时：最近若干场的中奖历史（true=中奖）
	WinHistory []bool
}

func (u *User) isVIP() bool { return u.Group == "vip" || u.Group == "svip" }

// ── 权重算法（与 model/lucky_bag.go 完全一致）─────────────────────────────────

const (
	ticketFloor    = 10
	ticketMeritCap = 40
	meritBonus     = 5.0
	vipMultiplier  = 1.5
	pityStep       = 0.2
	pityCap        = 10
	penaltyStep    = 0.5
	winLookback    = 5
)

func calcScore(u *User) float64 {
	return 1.0*math.Log2(1+float64(u.TotalQuota)/10000) +
		0.7*math.Log2(1+float64(u.TotalRecharge)/10000) +
		0.5*math.Log2(1+float64(u.LBEntries)) +
		0.4*math.Log2(1+float64(u.WeekQuota)/10000) +
		0.25*math.Log2(1+float64(u.InviteCount)*5) +
		0.1*math.Log2(1+float64(u.CheckinCount))
}

func calcPityLosses(u *User) int {
	losses := 0
	for i := len(u.WinHistory) - 1; i >= 0; i-- {
		if u.WinHistory[i] {
			break
		}
		losses++
	}
	if losses > pityCap {
		losses = pityCap
	}
	return losses
}

func calcRecentWins(u *User) int {
	lb := winLookback
	if len(u.WinHistory) < lb {
		lb = len(u.WinHistory)
	}
	wins := 0
	for _, w := range u.WinHistory[len(u.WinHistory)-lb:] {
		if w {
			wins++
		}
	}
	return wins
}

func calcWeight(u *User) int {
	score := calcScore(u)
	merit := meritBonus * math.Log2(1+score)
	if merit < 0 {
		merit = 0
	}
	if merit > ticketMeritCap {
		merit = ticketMeritCap
	}
	base := float64(ticketFloor) + merit

	vipM := 1.0
	if u.isVIP() {
		vipM = vipMultiplier
	}
	losses := calcPityLosses(u)
	pityM := 1.0 + pityStep*float64(losses)

	rw := calcRecentWins(u)
	penaltyM := math.Pow(penaltyStep, float64(rw))

	w := int(math.Round(base * vipM * pityM * penaltyM))
	if w < 1 {
		w = 1
	}
	return w
}

// ── 开奖核心（与 model/lucky_bag.go pickWinnerAndPersist 一致）─────────────────

type Entry struct {
	User   *User
	Weight int // 已应用非VIP折半
}

func weightedPickEntry(pool []Entry) (Entry, []Entry) {
	total := 0
	for _, e := range pool {
		total += e.Weight
	}
	if total == 0 {
		idx := rand.Intn(len(pool))
		rem := append(append([]Entry{}, pool[:idx]...), pool[idx+1:]...)
		return pool[idx], rem
	}
	pick := rand.Intn(total)
	cum := 0
	for i, e := range pool {
		cum += e.Weight
		if pick < cum {
			rem := append(append([]Entry{}, pool[:i]...), pool[i+1:]...)
			return e, rem
		}
	}
	last := len(pool) - 1
	return pool[last], pool[:last]
}

func randQuota(lo, hi int) int {
	if hi <= lo {
		return lo
	}
	return lo + rand.Intn(hi-lo+1)
}

type DrawResult struct {
	Winners [3]*User
	Quotas  [3]int
	Rank1NoVIP bool // 第1名因无VIP候选而空缺
}

func draw(participants []*User, minQ, maxQ int, recentWinners map[int]bool) DrawResult {
	span := maxQ - minQ
	quota1lo, quota1hi := minQ+span*75/100, maxQ
	quota2lo, quota2hi := minQ+span*40/100, minQ+span*75/100-1
	quota3lo, quota3hi := minQ, minQ+span*40/100-1
	midPoint := (minQ + maxQ) / 2

	// 构建候选池：排除48h内中奖者，非VIP权重折半
	pool := make([]Entry, 0, len(participants))
	for _, u := range participants {
		if recentWinners[u.ID] {
			continue // 48h内中过奖，本场排除
		}
		w := calcWeight(u)
		if !u.isVIP() {
			w = w / 2
			if w < 1 {
				w = 1
			}
		}
		pool = append(pool, Entry{User: u, Weight: w})
	}

	var result DrawResult

	// 第1名：仅VIP池
	vipPool := make([]Entry, 0)
	for _, e := range pool {
		if e.User.isVIP() {
			vipPool = append(vipPool, e)
		}
	}
	if len(vipPool) == 0 {
		result.Rank1NoVIP = true
	} else {
		winner, _ := weightedPickEntry(vipPool)
		result.Winners[0] = winner.User
		result.Quotas[0] = randQuota(quota1lo, quota1hi)
		// 从主池移除
		newPool := make([]Entry, 0, len(pool)-1)
		for _, e := range pool {
			if e.User.ID != winner.User.ID {
				newPool = append(newPool, e)
			}
		}
		pool = newPool
	}

	// 第2名
	if len(pool) > 0 {
		winner, remaining := weightedPickEntry(pool)
		pool = remaining
		q := randQuota(quota2lo, quota2hi)
		if !winner.User.isVIP() && q > midPoint {
			q = randQuota(minQ, midPoint)
		}
		result.Winners[1] = winner.User
		result.Quotas[1] = q
	}

	// 第3名
	if len(pool) > 0 {
		winner, _ := weightedPickEntry(pool)
		q := randQuota(quota3lo, quota3hi)
		if !winner.User.isVIP() && q > midPoint {
			q = randQuota(minQ, midPoint)
		}
		result.Winners[2] = winner.User
		result.Quotas[2] = q
	}

	return result
}

// ── 数据加载 ──────────────────────────────────────────────────────────────────

func loadUsers(db *sql.DB) ([]*User, error) {
	now := time.Now()
	weekAgoTs := now.AddDate(0, 0, -7).Unix()

	rows, err := db.Query(`
		SELECT id, username, "group"
		FROM users
		WHERE deleted_at IS NULL
		  AND id IN (SELECT DISTINCT user_id FROM lucky_bag_entries)`)
	if err != nil {
		return nil, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	userMap := make(map[int]*User)
	for rows.Next() {
		u := &User{}
		if err := rows.Scan(&u.ID, &u.Username, &u.Group); err != nil {
			continue
		}
		userMap[u.ID] = u
	}

	// 累计消耗 token
	r2, _ := db.Query(`SELECT user_id, COALESCE(SUM(quota),0) FROM logs WHERE type=2 GROUP BY user_id`)
	if r2 != nil {
		defer r2.Close()
		for r2.Next() {
			var uid int; var v int64
			if r2.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.TotalQuota = v }
			}
		}
	}

	// 充值总额：top_ups.amount（quota单位）
	r3, _ := db.Query(`SELECT user_id, COALESCE(SUM(amount),0) FROM top_ups WHERE status='success' GROUP BY user_id`)
	if r3 != nil {
		defer r3.Close()
		for r3.Next() {
			var uid int; var v int64
			if r3.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.TotalRecharge += v }
			}
		}
	}

	// 充值总额：subscription_orders.money * 10000（元→quota）
	r4, _ := db.Query(`SELECT user_id, COALESCE(SUM(CAST(money * 10000 AS BIGINT)),0) FROM subscription_orders WHERE status='success' GROUP BY user_id`)
	if r4 != nil {
		defer r4.Close()
		for r4.Next() {
			var uid int; var v int64
			if r4.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.TotalRecharge += v }
			}
		}
	}

	// 累计参与福袋次数
	r5, _ := db.Query(`SELECT user_id, COUNT(*) FROM lucky_bag_entries GROUP BY user_id`)
	if r5 != nil {
		defer r5.Close()
		for r5.Next() {
			var uid int; var v int64
			if r5.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.LBEntries = v }
			}
		}
	}

	// 近7天消耗
	r6, _ := db.Query(`SELECT user_id, COALESCE(SUM(quota),0) FROM logs WHERE type=2 AND created_at >= $1 GROUP BY user_id`, weekAgoTs)
	if r6 != nil {
		defer r6.Close()
		for r6.Next() {
			var uid int; var v int64
			if r6.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.WeekQuota = v }
			}
		}
	}

	// 邀请注册人数
	r7, _ := db.Query(`SELECT inviter_id, COUNT(*) FROM users WHERE inviter_id > 0 GROUP BY inviter_id`)
	if r7 != nil {
		defer r7.Close()
		for r7.Next() {
			var uid int; var v int64
			if r7.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.InviteCount = v }
			}
		}
	}

	// 累计签到次数
	r8, _ := db.Query(`SELECT user_id, COUNT(*) FROM checkins GROUP BY user_id`)
	if r8 != nil {
		defer r8.Close()
		for r8.Next() {
			var uid int; var v int64
			if r8.Scan(&uid, &v) == nil {
				if u, ok := userMap[uid]; ok { u.CheckinCount = v }
			}
		}
	}

	result := make([]*User, 0, len(userMap))
	for _, u := range userMap {
		result = append(result, u)
	}
	return result, nil
}

// ── 用户分类 ──────────────────────────────────────────────────────────────────

func bucket(u *User) string {
	if u.isVIP() && u.TotalQuota >= 50_000_000 {
		return "VIP大鲸鱼(累计≥5000万)"
	}
	if u.isVIP() {
		return "VIP普通"
	}
	if u.WeekQuota >= 1_000_000 {
		return "活跃非VIP(近7天≥100万)"
	}
	if u.TotalQuota > 0 {
		return "普通非VIP(有消费)"
	}
	return "零消费非VIP"
}

// ── 统计 ──────────────────────────────────────────────────────────────────────

type Stats struct {
	TotalDraws      int
	Rank1NoVIP      int    // 第1名因无VIP而空缺的场次
	VIPRank1        int    // 第1名是VIP的场次
	NonVIPRank1     int    // 第1名是非VIP的场次（应为0）
	RecentExcluded  int    // 被48h冷却排除的人次
	NonVIPOverMid   int    // 非VIP奖金超过中点的次数（应为0）

	WinsByUID   map[int][3]int
	BucketWins  map[string][3]int
	BucketWt    map[string][]int // 记录权重样本用于计算均值
}

func newStats() *Stats {
	return &Stats{
		WinsByUID:  make(map[int][3]int),
		BucketWins: make(map[string][3]int),
		BucketWt:   make(map[string][]int),
	}
}

// ── main ──────────────────────────────────────────────────────────────────────

func main() {
	dsn := flag.String("dsn",
		"postgresql://root:02bf6df436ba8a7a6551d7cd51efac26ff131ececf70af9da4021acd18cb17d6@127.0.0.1:15432/new-api?sslmode=disable",
		"PostgreSQL DSN")
	flag.Parse()

	rand.Seed(time.Now().UnixNano())

	db, err := sql.Open("pgx", *dsn)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		panic(fmt.Sprintf("DB 连接失败: %v\n请先建立隧道: ssh -L 15432:postgres:5432 aiproxy -N &", err))
	}
	fmt.Println("✅ 数据库连接成功，正在加载用户数据...")

	allUsers, err := loadUsers(db)
	if err != nil {
		panic(err)
	}
	fmt.Printf("✅ 加载完成：共 %d 个曾参与福袋的用户\n\n", len(allUsers))

	stats := newStats()
	const cases = 100
	const minQ, maxQ = 500_000, 5_000_000

	// 仿真时维护一个"近48h中奖者"集合，每轮滚动
	type winEvent struct {
		uid  int
		round int
	}
	var recentWinEvents []winEvent

	for round := 0; round < cases; round++ {
		// 构建当前轮的48h中奖集合（简化：用"最近2场"近似48h内）
		recentSet := make(map[int]bool)
		for _, ev := range recentWinEvents {
			if round-ev.round <= 2 {
				recentSet[ev.uid] = true
			}
		}
		stats.RecentExcluded += len(recentSet)

		// 随机抽取参与人数（贴近线上 16~61 人区间）
		nPart := 16 + rand.Intn(46)
		if nPart > len(allUsers) {
			nPart = len(allUsers)
		}
		shuffled := make([]*User, len(allUsers))
		copy(shuffled, allUsers)
		rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		participants := shuffled[:nPart]

		// 记录权重样本
		for _, u := range participants {
			w := calcWeight(u)
			b := bucket(u)
			stats.BucketWt[b] = append(stats.BucketWt[b], w)
		}

		result := draw(participants, minQ, maxQ, recentSet)
		stats.TotalDraws++

		if result.Rank1NoVIP {
			stats.Rank1NoVIP++
		}

		midPoint := (minQ + maxQ) / 2
		for rank, w := range result.Winners {
			if w == nil {
				continue
			}
			// 统计中奖
			wins := stats.WinsByUID[w.ID]
			wins[rank]++
			stats.WinsByUID[w.ID] = wins
			bw := stats.BucketWins[bucket(w)]
			bw[rank]++
			stats.BucketWins[bucket(w)] = bw

			// 检查第1名是否VIP
			if rank == 0 {
				if w.isVIP() {
					stats.VIPRank1++
				} else {
					stats.NonVIPRank1++
				}
				// 记录近期中奖
				recentWinEvents = append(recentWinEvents, winEvent{w.ID, round})
				w.WinHistory = append(w.WinHistory, true)
			}

			// 检查非VIP奖金是否超过中点
			if !w.isVIP() && rank > 0 && result.Quotas[rank] > midPoint {
				stats.NonVIPOverMid++
			}
		}

		// 未中奖用户追加 false
		winIDs := map[int]bool{}
		for _, w := range result.Winners {
			if w != nil {
				winIDs[w.ID] = true
			}
		}
		for _, u := range participants {
			if !winIDs[u.ID] {
				u.WinHistory = append(u.WinHistory, false)
				if len(u.WinHistory) > 20 {
					u.WinHistory = u.WinHistory[1:]
				}
			}
		}
	}

	// ── 输出报告 ──────────────────────────────────────────────────────────────

	sep := strings.Repeat("─", 72)
	fmt.Println()
	fmt.Println("╔════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║       🎁 福袋算法健康报告（基于线上真实数据，100 场随机仿真）         ║")
	fmt.Println("╚════════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// ── 检测 1：第1名 VIP 限制 ───────────────────────────────────────────────
	fmt.Println("【检测 1】第1名只能是VIP")
	if stats.NonVIPRank1 == 0 {
		fmt.Printf("  ✅ 通过 — 100场中，非VIP用户获得第1名：0次\n")
	} else {
		fmt.Printf("  ❌ 失败 — 非VIP用户获得第1名：%d次！\n", stats.NonVIPRank1)
	}
	fmt.Printf("  VIP获第1名：%d场 | 因无VIP候选空缺：%d场\n", stats.VIPRank1, stats.Rank1NoVIP)
	fmt.Println()

	// ── 检测 2：48h 冷却期 ───────────────────────────────────────────────────
	fmt.Println("【检测 2】48h 内中奖者冷却排除")
	avgExcluded := float64(stats.RecentExcluded) / float64(cases)
	fmt.Printf("  ✅ 每场平均排除近期中奖者：%.1f 人\n", avgExcluded)
	fmt.Println()

	// ── 检测 3：非VIP奖金上限 ────────────────────────────────────────────────
	fmt.Println("【检测 3】非VIP中奖额度不超过区间中点")
	if stats.NonVIPOverMid == 0 {
		fmt.Println("  ✅ 通过 — 非VIP用户中奖额度均未超过中点（275万）")
	} else {
		fmt.Printf("  ❌ 失败 — 发现 %d 次非VIP奖金超过中点！\n", stats.NonVIPOverMid)
	}
	fmt.Println()

	// ── 检测 4：权重分布 ─────────────────────────────────────────────────────
	fmt.Println("【检测 4】各类型用户权重分布")
	fmt.Printf("  %-26s  %6s  %6s  %7s  %5s\n", "用户分类", "最低", "最高", "均值", "样本")
	fmt.Println(" ", sep[:60])
	bucketOrder := []string{
		"VIP大鲸鱼(累计≥5000万)",
		"VIP普通",
		"活跃非VIP(近7天≥100万)",
		"普通非VIP(有消费)",
		"零消费非VIP",
	}
	for _, b := range bucketOrder {
		wts := stats.BucketWt[b]
		if len(wts) == 0 {
			continue
		}
		mn, mx := wts[0], wts[0]
		sum := 0
		for _, w := range wts {
			sum += w
			if w < mn { mn = w }
			if w > mx { mx = w }
		}
		avg := float64(sum) / float64(len(wts))
		fmt.Printf("  %-26s  %6d  %6d  %7.1f  %5d\n", b, mn, mx, avg, len(wts))
	}
	vipAvg := avgBucket(stats.BucketWt, "VIP大鲸鱼(累计≥5000万)", "VIP普通")
	nonVIPAvg := avgBucket(stats.BucketWt, "活跃非VIP(近7天≥100万)", "普通非VIP(有消费)", "零消费非VIP")
	if vipAvg > 0 && nonVIPAvg > 0 {
		ratio := vipAvg / nonVIPAvg
		status := "✅"
		if ratio < 1.5 {
			status = "⚠️ "
		}
		fmt.Printf("  %s VIP均值 / 非VIP均值 = %.2f（期望 > 1.5）\n", status, ratio)
	}
	fmt.Println()

	// ── 检测 5：中奖分布 ─────────────────────────────────────────────────────
	fmt.Println("【检测 5】各类型用户中奖分布（100 场次）")
	fmt.Printf("  %-26s  %6s  %6s  %6s  %8s\n", "用户分类", "第1名", "第2名", "第3名", "合计")
	fmt.Println(" ", sep[:62])
	totalWins := 0
	for _, w := range stats.BucketWins {
		totalWins += w[0] + w[1] + w[2]
	}
	pct := func(n int) string {
		if totalWins == 0 { return "0%" }
		return fmt.Sprintf("%.0f%%", 100.0*float64(n)/float64(totalWins))
	}
	for _, b := range bucketOrder {
		w := stats.BucketWins[b]
		total := w[0] + w[1] + w[2]
		if total == 0 && len(stats.BucketWt[b]) == 0 {
			continue
		}
		fmt.Printf("  %-26s  %6d  %6d  %6d  %8d (%s)\n", b, w[0], w[1], w[2], total, pct(total))
	}
	fmt.Println()

	// ── 检测 6：个人中奖 TOP 15 ─────────────────────────────────────────────
	fmt.Println("【检测 6】个人中奖排行 TOP 15")
	type uwin struct {
		u     *User
		wins  [3]int
		total int
	}
	var ranked []uwin
	uidMap := make(map[int]*User)
	for _, u := range allUsers {
		uidMap[u.ID] = u
	}
	for uid, w := range stats.WinsByUID {
		total := w[0] + w[1] + w[2]
		if total == 0 {
			continue
		}
		if u, ok := uidMap[uid]; ok {
			ranked = append(ranked, uwin{u, w, total})
		}
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].total > ranked[j].total })
	limit := 15
	if len(ranked) < limit {
		limit = len(ranked)
	}
	fmt.Printf("  %-6s  %-18s  %-5s  %-26s  %5s  %5s  %5s  %5s\n",
		"UID", "用户名", "VIP", "分类", "第1", "第2", "第3", "合计")
	fmt.Println(" ", sep)
	for _, r := range ranked[:limit] {
		name := r.u.Username
		if len(name) > 16 {
			name = name[:16] + ".."
		}
		vip := " "
		if r.u.isVIP() {
			vip = "✓"
		}
		fmt.Printf("  %-6d  %-18s  %-5s  %-26s  %5d  %5d  %5d  %5d\n",
			r.u.ID, name, vip, bucket(r.u), r.wins[0], r.wins[1], r.wins[2], r.total)
	}

	fmt.Println()
	fmt.Println(sep)
	fmt.Printf("  总场次：%d | 总中奖次数：%d | 参与用户数：%d\n",
		stats.TotalDraws, totalWins, len(allUsers))
	fmt.Println(sep)
	fmt.Println()
}

func avgBucket(m map[string][]int, keys ...string) float64 {
	sum, cnt := 0, 0
	for _, k := range keys {
		for _, w := range m[k] {
			sum += w
			cnt++
		}
	}
	if cnt == 0 {
		return 0
	}
	return float64(sum) / float64(cnt)
}
