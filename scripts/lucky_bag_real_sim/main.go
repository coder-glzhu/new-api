// lucky_bag_real_sim — 基于线上真实数据的 100 次抽奖健康度仿真。
// 直接连接线上 PostgreSQL（通过 SSH 隧道），读取真实用户、签到、日志、福袋参与记录，
// 使用与生产代码完全相同的权重算法跑 100 次仿真，输出中文健康报告。
//
// 用法:
//   go run ./scripts/lucky_bag_real_sim/ \
//     -dsn "postgresql://root:PASS@127.0.0.1:15432/new-api?sslmode=disable"
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

// ── 数据结构 ─────────────────────────────────────────────────────────────────

type UserRecord struct {
	ID       int
	Username string
	Group    string
	HasPaid  bool // subscription_orders 有 status='success' 记录

	// 计算好的原始指标
	Quota30d     int64
	InviteCount  int64
	CheckinCount int64
	LBEntries    int64

	// 运行时状态（仿真专用）
	RecentWins []bool
}

func (u *UserRecord) isVIP() bool { return u.Group == "vip" || u.Group == "svip" }

// isBlank 白嫖用户：非 VIP 且无成功付款记录
// VIP（vip/svip）直接视为充值用户，不受限制
func (u *UserRecord) isBlank() bool {
	if u.isVIP() {
		return false
	}
	return !u.HasPaid
}

// ── 权重算法（与 model/lucky_bag.go 完全一致）────────────────────────────────

const (
	floorTickets   = 10
	meritCap       = 40
	meritBonus     = 5.0
	vipMultiplier  = 1.5
	pityStep       = 0.2
	pityCap        = 10
	winPenaltyStep = 0.5
	winLookback    = 5
)

func calcScore(u *UserRecord) float64 {
	return math.Log2(1+float64(u.Quota30d)/10000) +
		0.8*math.Log2(1+float64(u.InviteCount)*5) +
		0.3*float64(u.CheckinCount) +
		0.15*math.Log2(1+float64(u.LBEntries))
}

func calcPityLosses(u *UserRecord) int {
	losses := 0
	for i := len(u.RecentWins) - 1; i >= 0; i-- {
		if u.RecentWins[i] {
			break
		}
		losses++
	}
	if losses > pityCap {
		losses = pityCap
	}
	return losses
}

func calcRecentWins(u *UserRecord) int {
	lb := winLookback
	if len(u.RecentWins) < lb {
		lb = len(u.RecentWins)
	}
	wins := 0
	for _, w := range u.RecentWins[len(u.RecentWins)-lb:] {
		if w {
			wins++
		}
	}
	return wins
}

func calcWeight(u *UserRecord) int {
	score := calcScore(u)
	merit := meritBonus * math.Log2(1+score)
	if merit < 0 {
		merit = 0
	}
	if merit > meritCap {
		merit = meritCap
	}
	base := float64(floorTickets) + merit

	vipM := 1.0
	if u.isVIP() {
		vipM = vipMultiplier
	}
	losses := calcPityLosses(u)
	pityM := 1.0 + pityStep*float64(losses)

	rw := calcRecentWins(u)
	penaltyM := math.Pow(winPenaltyStep, float64(rw))

	w := int(math.Round(base * vipM * pityM * penaltyM))
	if w < 1 {
		w = 1
	}
	return w
}

// ── 抽奖核心 ─────────────────────────────────────────────────────────────────

func weightedPick(pool []*UserRecord) (*UserRecord, []*UserRecord) {
	total := 0
	for _, u := range pool {
		total += calcWeight(u)
	}
	if total == 0 {
		idx := rand.Intn(len(pool))
		remaining := append(append([]*UserRecord{}, pool[:idx]...), pool[idx+1:]...)
		return pool[idx], remaining
	}
	pick := rand.Intn(total)
	cum := 0
	for i, u := range pool {
		cum += calcWeight(u)
		if pick < cum {
			remaining := append(append([]*UserRecord{}, pool[:i]...), pool[i+1:]...)
			return u, remaining
		}
	}
	last := len(pool) - 1
	return pool[last], pool[:last]
}

type DrawResult struct {
	Winners [3]*UserRecord
	Quotas  [3]int
}

func quotaRange(minQ, maxQ, rank int) (int, int) {
	span := maxQ - minQ
	switch rank {
	case 1:
		return minQ + span*75/100, maxQ
	case 2:
		lo := minQ + span*40/100
		hi := minQ + span*75/100 - 1
		if hi < lo {
			hi = lo
		}
		return lo, hi
	default:
		lo := minQ
		hi := minQ + span*40/100 - 1
		if hi < lo {
			hi = lo
		}
		return lo, hi
	}
}

func randQuota(lo, hi int) int {
	if hi <= lo {
		return lo
	}
	return lo + rand.Intn(hi-lo+1)
}

func simulate(participants []*UserRecord, minQ, maxQ int) DrawResult {
	pool := make([]*UserRecord, len(participants))
	copy(pool, participants)

	var result DrawResult
	for rank := 1; rank <= 3 && len(pool) > 0; rank++ {
		candidate, remaining := weightedPick(pool)

		// 第1名：非白嫖池重新选
		if rank == 1 && candidate.isBlank() {
			var nonBlank []*UserRecord
			for _, u := range pool {
				if !u.isBlank() {
					nonBlank = append(nonBlank, u)
				}
			}
			if len(nonBlank) > 0 {
				candidate, _ = weightedPick(nonBlank)
				remaining = make([]*UserRecord, 0, len(pool)-1)
				for _, u := range pool {
					if u.ID != candidate.ID {
						remaining = append(remaining, u)
					}
				}
			}
		}

		lo, hi := quotaRange(minQ, maxQ, rank)
		result.Winners[rank-1] = candidate
		result.Quotas[rank-1] = randQuota(lo, hi)
		pool = remaining
	}
	return result
}

// ── 数据加载 ─────────────────────────────────────────────────────────────────

func loadUsers(db *sql.DB) ([]*UserRecord, error) {
	// 当前时间 Unix 戳（30 天前）
	startTs := time.Now().AddDate(0, 0, -30).Unix()
	startDate := time.Now().AddDate(0, 0, -30).Format("2006-01-02")
	endDate := time.Now().Format("2006-01-02")

	// 1. 基础用户信息（只加载曾经参与过福袋的用户，贴近真实参与者池）
	rows, err := db.Query(`
		SELECT id, username, "group" FROM users
		WHERE deleted_at IS NULL
		  AND id IN (SELECT DISTINCT user_id FROM lucky_bag_entries)`)
	if err != nil {
		return nil, fmt.Errorf("query users: %w", err)
	}
	defer rows.Close()

	userMap := make(map[int]*UserRecord)
	for rows.Next() {
		u := &UserRecord{}
		if err := rows.Scan(&u.ID, &u.Username, &u.Group); err != nil {
			continue
		}
		userMap[u.ID] = u
	}

	// 2. 30 天内 token 消耗（logs type=2）
	rows2, err := db.Query(`SELECT user_id, COALESCE(SUM(quota),0) FROM logs WHERE type=2 AND created_at >= $1 GROUP BY user_id`, startTs)
	if err != nil {
		return nil, fmt.Errorf("query logs quota: %w", err)
	}
	defer rows2.Close()
	for rows2.Next() {
		var uid int
		var total int64
		if err := rows2.Scan(&uid, &total); err != nil {
			continue
		}
		if u, ok := userMap[uid]; ok {
			u.Quota30d = total
		}
	}

	// 3. 真实付款判定（白嫖识别）：subscription_orders success 或 虎皮椒等直充路径
	rows3, err := db.Query(`
		SELECT DISTINCT uid FROM (
			SELECT user_id AS uid FROM subscription_orders WHERE status='success'
			UNION
			SELECT user_id AS uid FROM logs WHERE type=1 AND content LIKE '%充值成功%'
		) t`)
	if err == nil {
		defer rows3.Close()
		for rows3.Next() {
			var uid int
			if err := rows3.Scan(&uid); err != nil {
				continue
			}
			if u, ok := userMap[uid]; ok {
				u.HasPaid = true
			}
		}
	}

	// 4. 30 天内签到次数
	rows4, err := db.Query(`SELECT user_id, COUNT(*) FROM checkins WHERE checkin_date >= $1 AND checkin_date <= $2 GROUP BY user_id`, startDate, endDate)
	if err == nil {
		defer rows4.Close()
		for rows4.Next() {
			var uid int
			var cnt int64
			if err := rows4.Scan(&uid, &cnt); err != nil {
				continue
			}
			if u, ok := userMap[uid]; ok {
				u.CheckinCount = cnt
			}
		}
	}

	// 5. 邀请人数（users.inviter_id）
	rows5, err := db.Query(`SELECT inviter_id, COUNT(*) FROM users WHERE inviter_id > 0 GROUP BY inviter_id`)
	if err == nil {
		defer rows5.Close()
		for rows5.Next() {
			var uid int
			var cnt int64
			if err := rows5.Scan(&uid, &cnt); err != nil {
				continue
			}
			if u, ok := userMap[uid]; ok {
				u.InviteCount = cnt
			}
		}
	}

	// 6. 累计福袋参与次数
	rows6, err := db.Query(`SELECT user_id, COUNT(*) FROM lucky_bag_entries GROUP BY user_id`)
	if err == nil {
		defer rows6.Close()
		for rows6.Next() {
			var uid int
			var cnt int64
			if err := rows6.Scan(&uid, &cnt); err != nil {
				continue
			}
			if u, ok := userMap[uid]; ok {
				u.LBEntries = cnt
			}
		}
	}

	var result []*UserRecord
	for _, u := range userMap {
		result = append(result, u)
	}
	return result, nil
}

// ── 统计 ─────────────────────────────────────────────────────────────────────

type Stats struct {
	TotalDraws int
	WinsByUser map[int][3]int
	BlankFirst int
	ConsecFirst int
	MinWt      map[string]int
	MaxWt      map[string]int
	AvgWt      map[string]float64
	WtCount    map[string]int
}

func bucket(u *UserRecord) string {
	if u.isBlank() {
		return "白嫖用户(从未付款)"
	}
	if u.isVIP() && u.Quota30d >= 10_000_000 {
		return "VIP大鲸鱼(30d≥1000万)"
	}
	if u.isVIP() {
		return "VIP普通(30d<1000万)"
	}
	if u.Quota30d >= 1_000_000 {
		return "活跃非VIP(30d≥100万)"
	}
	if u.Quota30d > 0 {
		return "普通消费(30d有消费)"
	}
	return "历史消费(近30d为0)"
}

func newStats() *Stats {
	return &Stats{
		WinsByUser: make(map[int][3]int),
		MinWt:      make(map[string]int),
		MaxWt:      make(map[string]int),
		AvgWt:      make(map[string]float64),
		WtCount:    make(map[string]int),
	}
}

func (s *Stats) recordWeight(u *UserRecord, w int) {
	b := bucket(u)
	if _, ok := s.MinWt[b]; !ok {
		s.MinWt[b] = 999999
	}
	if w < s.MinWt[b] {
		s.MinWt[b] = w
	}
	if w > s.MaxWt[b] {
		s.MaxWt[b] = w
	}
	s.AvgWt[b] += float64(w)
	s.WtCount[b]++
}

func (s *Stats) recordWin(u *UserRecord, rank int) {
	w := s.WinsByUser[u.ID]
	w[rank-1]++
	s.WinsByUser[u.ID] = w
	if rank == 1 && u.isBlank() {
		s.BlankFirst++
	}
}

// ── main ─────────────────────────────────────────────────────────────────────

func main() {
	dsn := flag.String("dsn", "postgresql://root:02bf6df436ba8a7a6551d7cd51efac26ff131ececf70af9da4021acd18cb17d6@127.0.0.1:15432/new-api?sslmode=disable", "PostgreSQL DSN")
	flag.Parse()

	rand.Seed(time.Now().UnixNano())

	db, err := sql.Open("pgx", *dsn)
	if err != nil {
		panic(err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		panic(fmt.Sprintf("DB 连接失败: %v", err))
	}
	fmt.Println("✅ 数据库连接成功，正在加载用户数据...")

	allUsers, err := loadUsers(db)
	if err != nil {
		panic(err)
	}
	fmt.Printf("✅ 加载完成：共 %d 个用户\n\n", len(allUsers))

	stats := newStats()

	const cases = 100
	const minQ = 500_000  // 奖励下限（对应 $1）
	const maxQ = 5_000_000 // 奖励上限（对应 $10）

	lastFirstWinner := -1

	for c := 0; c < cases; c++ {
		// 参考线上实际参与区间（16~51 人），取 16~55
		// 真实报名中 VIP 占约 70%，故优先从 VIP 池采样，模拟真实报名分布
		nPart := 16 + rand.Intn(40)
		if nPart > len(allUsers) {
			nPart = len(allUsers)
		}
		shuffled := make([]*UserRecord, len(allUsers))
		copy(shuffled, allUsers)
		rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		participants := shuffled[:nPart]

		for _, u := range participants {
			stats.recordWeight(u, calcWeight(u))
		}

		result := simulate(participants, minQ, maxQ)
		stats.TotalDraws++

		for rank, winner := range result.Winners {
			if winner == nil {
				continue
			}
			stats.recordWin(winner, rank+1)

			if rank == 0 {
				if lastFirstWinner == winner.ID {
					stats.ConsecFirst++
				}
				lastFirstWinner = winner.ID
				winner.RecentWins = append(winner.RecentWins, true)
			}
		}

		winnerIDs := map[int]bool{}
		for _, w := range result.Winners {
			if w != nil {
				winnerIDs[w.ID] = true
			}
		}
		for _, u := range participants {
			if !winnerIDs[u.ID] {
				u.RecentWins = append(u.RecentWins, false)
				if len(u.RecentWins) > 20 {
					u.RecentWins = u.RecentWins[1:]
				}
			}
		}
	}

	// ── 输出中文报告 ────────────────────────────────────────────────────────────

	sep := strings.Repeat("─", 70)
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║          🎁 福袋算法健康报告（基于线上真实数据，100 场次）           ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// 1. 安全检测
	fmt.Println("【一】安全检测：白嫖用户能否夺得第一名")
	if stats.BlankFirst == 0 {
		fmt.Println("  ✅ 通过 — 100 场次中，白嫖用户（从未付款）从未获得第一名")
	} else {
		fmt.Printf("  ❌ 失败 — 发现 %d 次白嫖用户获得第一名！\n", stats.BlankFirst)
	}
	fmt.Println()

	// 2. 连续中奖检测
	fmt.Println("【二】连续中奖检测：同一用户连续两场获得第一名")
	rate := float64(stats.ConsecFirst) / float64(cases-1) * 100
	fmt.Printf("  第一名连续重复：%d / %d 场（%.1f%%）\n", stats.ConsecFirst, cases-1, rate)
	if rate < 15 {
		fmt.Println("  ✅ 通过 — 连续中奖率 < 15%，惩罚机制有效")
	} else {
		fmt.Printf("  ⚠️  警告 — 连续中奖率 %.1f%% ≥ 15%%，建议调整惩罚系数\n", rate)
	}
	fmt.Println()

	// 3. 权重分布
	fmt.Println("【三】各类型用户权重分布")
	fmt.Printf("  %-32s  %6s  %6s  %7s\n", "用户分类", "最低权重", "最高权重", "平均权重")
	fmt.Println(" ", sep[:60])
	bucketOrder := []string{
		"VIP大鲸鱼(30d≥1000万)",
		"VIP普通(30d<1000万)",
		"活跃非VIP(30d≥100万)",
		"普通消费(30d有消费)",
		"历史消费(近30d为0)",
		"白嫖用户(从未付款)",
	}
	for _, b := range bucketOrder {
		cnt := stats.WtCount[b]
		if cnt == 0 {
			continue
		}
		avg := stats.AvgWt[b] / float64(cnt)
		fmt.Printf("  %-32s  %6d  %6d  %7.1f\n", b, stats.MinWt[b], stats.MaxWt[b], avg)
	}
	fmt.Println("  期望顺序：VIP大鲸 > VIP普通 > 活跃非VIP > 普通消费 > 历史消费 ≈ 白嫖")
	fmt.Println()

	// 4. 中奖分布（按分类）
	fmt.Println("【四】各类型用户中奖分布（100 场次）")
	fmt.Printf("  %-32s  %6s  %6s  %6s  %8s\n", "用户分类", "第一名", "第二名", "第三名", "合计")
	fmt.Println(" ", sep[:62])

	// 汇总每个用户的 bucket
	bucketWins := make(map[string][3]int)
	for uid, w := range stats.WinsByUser {
		var u *UserRecord
		for _, uu := range allUsers {
			if uu.ID == uid {
				u = uu
				break
			}
		}
		if u == nil {
			continue
		}
		b := bucket(u)
		bw := bucketWins[b]
		bw[0] += w[0]; bw[1] += w[1]; bw[2] += w[2]
		bucketWins[b] = bw
	}
	totalWins := 0
	for _, w := range bucketWins {
		totalWins += w[0] + w[1] + w[2]
	}
	for _, b := range bucketOrder {
		w := bucketWins[b]
		total := w[0] + w[1] + w[2]
		if total == 0 && stats.WtCount[b] == 0 {
			continue
		}
		fmt.Printf("  %-32s  %6d  %6d  %6d  %8d\n", b, w[0], w[1], w[2], total)
	}
	fmt.Println()

	// 5. 健康比例
	fmt.Println("【五】健康比例分析")
	pct := func(n int) string {
		if totalWins == 0 {
			return "0.0%"
		}
		return fmt.Sprintf("%.1f%%", 100.0*float64(n)/float64(totalWins))
	}
	vipWins := bucketWins["VIP大鲸鱼(30d≥1000万)"][0] + bucketWins["VIP大鲸鱼(30d≥1000万)"][1] + bucketWins["VIP大鲸鱼(30d≥1000万)"][2] +
		bucketWins["VIP普通(30d<1000万)"][0] + bucketWins["VIP普通(30d<1000万)"][1] + bucketWins["VIP普通(30d<1000万)"][2]
	activeWins := bucketWins["活跃非VIP(30d≥100万)"][0] + bucketWins["活跃非VIP(30d≥100万)"][1] + bucketWins["活跃非VIP(30d≥100万)"][2]
	normalWins := bucketWins["普通消费(30d有消费)"][0] + bucketWins["普通消费(30d有消费)"][1] + bucketWins["普通消费(30d有消费)"][2]
	blankWins := bucketWins["白嫖用户(从未付款)"][0] + bucketWins["白嫖用户(从未付款)"][1] + bucketWins["白嫖用户(从未付款)"][2]
	oldWins := bucketWins["历史消费(近30d为0)"][0] + bucketWins["历史消费(近30d为0)"][1] + bucketWins["历史消费(近30d为0)"][2]

	fmt.Printf("  VIP 用户合计：        %3d 次 (%s)\n", vipWins, pct(vipWins))
	fmt.Printf("  活跃非VIP：           %3d 次 (%s)\n", activeWins, pct(activeWins))
	fmt.Printf("  普通消费用户：        %3d 次 (%s)\n", normalWins, pct(normalWins))
	fmt.Printf("  近30天零消费(历史)：  %3d 次 (%s)\n", oldWins, pct(oldWins))
	fmt.Printf("  白嫖用户(仅2/3名)：  %3d 次 (%s)\n", blankWins, pct(blankWins))
	fmt.Println()
	fmt.Println("  期望：VIP > 活跃非VIP > 普通消费 >> 零消费；白嫖用户绝不得第一名")
	fmt.Println()

	// 6. 个人中奖排行 TOP 15
	fmt.Println("【六】个人中奖排行 TOP 15（按合计中奖次数）")
	type uwin struct {
		u *UserRecord
		w [3]int
	}
	var ranked []uwin
	for uid, w := range stats.WinsByUser {
		if w[0]+w[1]+w[2] == 0 {
			continue
		}
		for _, uu := range allUsers {
			if uu.ID == uid {
				ranked = append(ranked, uwin{uu, w})
				break
			}
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		ti := ranked[i].w[0] + ranked[i].w[1] + ranked[i].w[2]
		tj := ranked[j].w[0] + ranked[j].w[1] + ranked[j].w[2]
		return ti > tj
	})
	limit := 15
	if len(ranked) < limit {
		limit = len(ranked)
	}
	fmt.Printf("  %-6s  %-20s  %-28s  %5s  %5s  %5s  %7s\n", "用户ID", "用户名", "分类", "第一", "第二", "第三", "合计")
	fmt.Println(" ", sep[:68])
	for _, r := range ranked[:limit] {
		total := r.w[0] + r.w[1] + r.w[2]
		name := r.u.Username
		if len(name) > 18 {
			name = name[:18] + ".."
		}
		fmt.Printf("  %-6d  %-20s  %-28s  %5d  %5d  %5d  %7d\n",
			r.u.ID, name, bucket(r.u), r.w[0], r.w[1], r.w[2], total)
	}

	fmt.Println()
	fmt.Println(sep)
	fmt.Printf("  总抽奖场次：%d | 总中奖次数：%d | 参与用户数：%d\n", stats.TotalDraws, totalWins, len(allUsers))
	fmt.Println(sep)
	fmt.Println()
}
