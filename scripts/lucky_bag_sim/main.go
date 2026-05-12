// lucky_bag_sim — 与 model/lucky_bag.go 保持完全一致的 Monte-Carlo 仿真。
// 规则：
//   1. 活跃度（六维 log 压缩）→ 基础票数 [10, 50]
//   2. VIP 倍率 ×1.5
//   3. 近期中奖惩罚：近 5 场中奖 k 次 → ×0.5^k
//   4. 48h 内中奖者排除出本场候选池（仿真用"最近 2 场"近似）
//   5. 非 VIP 权重再 ×0.5（floor=1）
//   6. 第 1 名只能来自 VIP 子池；无 VIP 则空缺
//   7. 非 VIP 中奖额度上限压至区间中点
//
// 运行：go run ./scripts/lucky_bag_sim/
package main

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"
)

// ── 常量（与 model/lucky_bag.go 完全一致）─────────────────────────────────────

const (
	ticketFloor    = 10
	ticketMeritCap = 40
	meritBonus     = 5.0

	vipMultiplier     = 1.5
	recentWinLookback = 5
	winPenaltyStep    = 0.5
)

// ── 用户模型 ─────────────────────────────────────────────────────────────────

type User struct {
	ID       int
	Name     string
	Archetype string
	Group    string // "default" | "vip" | "svip"

	// calcUserScore 六个维度
	TotalQuota   int64  // 累计消耗 token
	TotalRecharge int64 // 充值总额（quota 单位）
	LBEntries    int64  // 累计参与福袋次数
	WeekQuota    int64  // 近 7 天消耗 token
	InviteCount  int64  // 邀请注册人数
	CheckinCount int64  // 累计签到次数

	// 仿真运行时
	WinHistory []bool // 近 N 场中奖记录（true=中任意名次）
}

func (u *User) isVIP() bool { return u.Group == "vip" || u.Group == "svip" }

// ── 权重算法（镜像 model/lucky_bag.go）──────────────────────────────────────

func calcScore(u *User) float64 {
	return 1.0*math.Log2(1+float64(u.TotalQuota)/10000) +
		0.7*math.Log2(1+float64(u.TotalRecharge)/10000) +
		0.5*math.Log2(1+float64(u.LBEntries)) +
		0.4*math.Log2(1+float64(u.WeekQuota)/10000) +
		0.25*math.Log2(1+float64(u.InviteCount)*5) +
		0.1*math.Log2(1+float64(u.CheckinCount))
}

func calcRecentWins(u *User) int {
	lb := recentWinLookback
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

	rw := calcRecentWins(u)
	penaltyM := math.Pow(winPenaltyStep, float64(rw))

	w := int(math.Round(base * vipM * penaltyM))
	if w < 1 {
		w = 1
	}
	return w
}

// ── 开奖（镜像 model/lucky_bag.go pickWinnerAndPersist）─────────────────────

type Entry struct {
	User   *User
	Weight int // 已应用非 VIP ×0.5
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
	Winners    [3]*User
	Quotas     [3]int
	Rank1NoVIP bool // 第 1 名因无 VIP 候选而空缺
}

func draw(participants []*User, minQ, maxQ int, recentWinners map[int]bool) DrawResult {
	span := maxQ - minQ
	quota1lo, quota1hi := minQ+span*75/100, maxQ
	quota2lo, quota2hi := minQ+span*40/100, minQ+span*75/100-1
	quota3lo, quota3hi := minQ, minQ+span*40/100-1
	midPoint := (minQ + maxQ) / 2

	// 排除 48h 内中奖者，非 VIP 权重 ×0.5
	pool := make([]Entry, 0, len(participants))
	for _, u := range participants {
		if recentWinners[u.ID] {
			continue
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

	// 第 1 名：仅 VIP 子池
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
		newPool := make([]Entry, 0, len(pool)-1)
		for _, e := range pool {
			if e.User.ID != winner.User.ID {
				newPool = append(newPool, e)
			}
		}
		pool = newPool
	}

	// 第 2 名
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

	// 第 3 名
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

// ── 用户原型库 ───────────────────────────────────────────────────────────────

func makeUsers() []*User {
	id := 0
	next := func() int { id++; return id }

	return []*User{
		// VIP 大鲸鱼
		{ID: next(), Name: "Whale-VIP-1", Archetype: "whale_vip", Group: "vip",
			TotalQuota: 500_000_000, TotalRecharge: 50_000_000, LBEntries: 90, WeekQuota: 30_000_000, InviteCount: 20, CheckinCount: 300},
		{ID: next(), Name: "Whale-VIP-2", Archetype: "whale_vip", Group: "svip",
			TotalQuota: 800_000_000, TotalRecharge: 80_000_000, LBEntries: 120, WeekQuota: 50_000_000, InviteCount: 30, CheckinCount: 400},
		{ID: next(), Name: "Whale-VIP-3", Archetype: "whale_vip", Group: "vip",
			TotalQuota: 300_000_000, TotalRecharge: 30_000_000, LBEntries: 60, WeekQuota: 20_000_000, InviteCount: 10, CheckinCount: 200},

		// VIP 中等
		{ID: next(), Name: "Mid-VIP-1", Archetype: "mid_vip", Group: "vip",
			TotalQuota: 50_000_000, TotalRecharge: 5_000_000, LBEntries: 30, WeekQuota: 3_000_000, InviteCount: 3, CheckinCount: 60},
		{ID: next(), Name: "Mid-VIP-2", Archetype: "mid_vip", Group: "vip",
			TotalQuota: 30_000_000, TotalRecharge: 3_000_000, LBEntries: 20, WeekQuota: 2_000_000, InviteCount: 1, CheckinCount: 40},
		{ID: next(), Name: "Mid-VIP-3", Archetype: "mid_vip", Group: "vip",
			TotalQuota: 80_000_000, TotalRecharge: 8_000_000, LBEntries: 40, WeekQuota: 5_000_000, InviteCount: 7, CheckinCount: 80},

		// 活跃非 VIP
		{ID: next(), Name: "Active-1", Archetype: "active_nonvip", Group: "default",
			TotalQuota: 40_000_000, TotalRecharge: 4_000_000, LBEntries: 25, WeekQuota: 3_000_000, InviteCount: 2, CheckinCount: 50},
		{ID: next(), Name: "Active-2", Archetype: "active_nonvip", Group: "default",
			TotalQuota: 25_000_000, TotalRecharge: 2_500_000, LBEntries: 15, WeekQuota: 1_500_000, InviteCount: 0, CheckinCount: 30},
		{ID: next(), Name: "Active-3", Archetype: "active_nonvip", Group: "default",
			TotalQuota: 60_000_000, TotalRecharge: 6_000_000, LBEntries: 45, WeekQuota: 4_000_000, InviteCount: 4, CheckinCount: 70},
		{ID: next(), Name: "Active-4", Archetype: "active_nonvip", Group: "default",
			TotalQuota: 12_000_000, TotalRecharge: 1_200_000, LBEntries: 20, WeekQuota: 800_000, InviteCount: 1, CheckinCount: 20},

		// 普通用户
		{ID: next(), Name: "Casual-1", Archetype: "casual", Group: "default",
			TotalQuota: 2_000_000, TotalRecharge: 200_000, LBEntries: 8, WeekQuota: 100_000, InviteCount: 0, CheckinCount: 10},
		{ID: next(), Name: "Casual-2", Archetype: "casual", Group: "default",
			TotalQuota: 1_000_000, TotalRecharge: 100_000, LBEntries: 5, WeekQuota: 50_000, InviteCount: 0, CheckinCount: 5},
		{ID: next(), Name: "Casual-3", Archetype: "casual", Group: "default",
			TotalQuota: 500_000, TotalRecharge: 50_000, LBEntries: 3, WeekQuota: 20_000, InviteCount: 0, CheckinCount: 3},
		{ID: next(), Name: "Casual-4", Archetype: "casual", Group: "default",
			TotalQuota: 3_000_000, TotalRecharge: 300_000, LBEntries: 10, WeekQuota: 200_000, InviteCount: 1, CheckinCount: 15},
		{ID: next(), Name: "Casual-5", Archetype: "casual", Group: "default",
			TotalQuota: 800_000, TotalRecharge: 80_000, LBEntries: 6, WeekQuota: 40_000, InviteCount: 0, CheckinCount: 8},

		// 邀请达人（消费少，邀请多）
		{ID: next(), Name: "Inviter-1", Archetype: "inviter", Group: "default",
			TotalQuota: 1_000_000, TotalRecharge: 100_000, LBEntries: 30, WeekQuota: 50_000, InviteCount: 20, CheckinCount: 60},
		{ID: next(), Name: "Inviter-2", Archetype: "inviter", Group: "default",
			TotalQuota: 500_000, TotalRecharge: 50_000, LBEntries: 20, WeekQuota: 20_000, InviteCount: 10, CheckinCount: 40},

		// 新用户
		{ID: next(), Name: "Newbie-1", Archetype: "newbie", Group: "default",
			TotalQuota: 100_000, TotalRecharge: 0, LBEntries: 1, WeekQuota: 100_000, InviteCount: 0, CheckinCount: 1},
		{ID: next(), Name: "Newbie-2", Archetype: "newbie", Group: "default",
			TotalQuota: 50_000, TotalRecharge: 0, LBEntries: 1, WeekQuota: 50_000, InviteCount: 0, CheckinCount: 0},

		// 零消费非 VIP
		{ID: next(), Name: "Zero-1", Archetype: "zero", Group: "default",
			TotalQuota: 0, TotalRecharge: 0, LBEntries: 5, WeekQuota: 0, InviteCount: 0, CheckinCount: 2},
		{ID: next(), Name: "Zero-2", Archetype: "zero", Group: "default",
			TotalQuota: 0, TotalRecharge: 0, LBEntries: 10, WeekQuota: 0, InviteCount: 1, CheckinCount: 8},
	}
}

// ── 统计 ─────────────────────────────────────────────────────────────────────

type Stats struct {
	TotalDraws     int
	Rank1NoVIP     int
	NonVIPRank1    int // 第 1 名是非 VIP 的次数（应为 0）
	NonVIPOverMid  int // 非 VIP 奖金超过中点的次数（应为 0）

	ArchWins   map[string][3]int
	ArchWt     map[string][]int // 权重样本
	UserWins   map[string][3]int
}

func newStats() *Stats {
	return &Stats{
		ArchWins: make(map[string][3]int),
		ArchWt:   make(map[string][]int),
		UserWins: make(map[string][3]int),
	}
}

// ── main ─────────────────────────────────────────────────────────────────────

func main() {
	rand.Seed(time.Now().UnixNano())

	users := makeUsers()
	stats := newStats()

	const cases = 10_000
	const minQ, maxQ = 500_000, 5_000_000
	midPoint := (minQ + maxQ) / 2

	// 48h 冷却：仿真用"最近 2 场中奖"近似
	type winEvent struct {
		uid   int
		round int
	}
	var recentEvents []winEvent

	for round := 0; round < cases; round++ {
		// 构建 48h 冷却集合
		recentSet := make(map[int]bool)
		for _, ev := range recentEvents {
			if round-ev.round <= 2 {
				recentSet[ev.uid] = true
			}
		}

		// 随机抽取参与人数 [3, len(users)]
		nPart := 3 + rand.Intn(len(users)-2)
		shuffled := make([]*User, len(users))
		copy(shuffled, users)
		rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		participants := shuffled[:nPart]

		// 记录权重样本
		for _, u := range participants {
			w := calcWeight(u)
			stats.ArchWt[u.Archetype] = append(stats.ArchWt[u.Archetype], w)
		}

		result := draw(participants, minQ, maxQ, recentSet)
		stats.TotalDraws++

		if result.Rank1NoVIP {
			stats.Rank1NoVIP++
		}

		winIDs := map[int]bool{}
		for rank, w := range result.Winners {
			if w == nil {
				continue
			}
			winIDs[w.ID] = true

			aw := stats.ArchWins[w.Archetype]
			aw[rank]++
			stats.ArchWins[w.Archetype] = aw

			uw := stats.UserWins[w.Name]
			uw[rank]++
			stats.UserWins[w.Name] = uw

			if rank == 0 && !w.isVIP() {
				stats.NonVIPRank1++
			}
			if rank > 0 && !w.isVIP() && result.Quotas[rank] > midPoint {
				stats.NonVIPOverMid++
			}

			// 仅记录 48h 冷却事件
			recentEvents = append(recentEvents, winEvent{w.ID, round})
			w.WinHistory = append(w.WinHistory, true)
			if len(w.WinHistory) > 20 {
				w.WinHistory = w.WinHistory[1:]
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

	// ── 报告 ─────────────────────────────────────────────────────────────────

	sep := strings.Repeat("─", 72)
	fmt.Println()
	fmt.Println("╔════════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║          🎁 福袋算法健康报告（纯仿真，10,000 场）                     ║")
	fmt.Println("╚════════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// 检测 1：第 1 名必须是 VIP
	fmt.Println("【检测 1】第 1 名只能是 VIP")
	if stats.NonVIPRank1 == 0 {
		fmt.Printf("  ✅ 通过 — 10000 场中非 VIP 获第 1 名：0 次\n")
	} else {
		fmt.Printf("  ❌ 失败 — 非 VIP 获第 1 名：%d 次\n", stats.NonVIPRank1)
	}
	fmt.Printf("  第 1 名因无 VIP 候选空缺：%d 场（%.1f%%）\n",
		stats.Rank1NoVIP, 100.0*float64(stats.Rank1NoVIP)/float64(cases))
	fmt.Println()

	// 检测 2：非 VIP 奖金上限
	fmt.Println("【检测 2】非 VIP 中奖额度不超过区间中点")
	if stats.NonVIPOverMid == 0 {
		fmt.Println("  ✅ 通过 — 非 VIP 奖金均未超过中点")
	} else {
		fmt.Printf("  ❌ 失败 — 发现 %d 次超过中点\n", stats.NonVIPOverMid)
	}
	fmt.Println()

	// 检测 3：权重分布
	fmt.Println("【检测 3】各类型用户权重分布")
	fmt.Printf("  %-18s  %6s  %6s  %7s  %6s\n", "原型", "最低", "最高", "均值", "样本")
	fmt.Println(" ", sep[:60])
	archetypeOrder := []string{"whale_vip", "mid_vip", "active_nonvip", "inviter", "casual", "newbie", "zero"}
	for _, a := range archetypeOrder {
		wts := stats.ArchWt[a]
		if len(wts) == 0 {
			continue
		}
		mn, mx, sum := wts[0], wts[0], 0
		for _, w := range wts {
			sum += w
			if w < mn { mn = w }
			if w > mx { mx = w }
		}
		avg := float64(sum) / float64(len(wts))
		fmt.Printf("  %-18s  %6d  %6d  %7.1f  %6d\n", a, mn, mx, avg, len(wts))
	}
	// VIP vs 非 VIP 均值比
	vipSum, vipCnt := 0, 0
	for _, a := range []string{"whale_vip", "mid_vip"} {
		for _, w := range stats.ArchWt[a] { vipSum += w; vipCnt++ }
	}
	nvSum, nvCnt := 0, 0
	for _, a := range []string{"active_nonvip", "casual", "inviter", "newbie", "zero"} {
		for _, w := range stats.ArchWt[a] { nvSum += w; nvCnt++ }
	}
	if vipCnt > 0 && nvCnt > 0 {
		ratio := float64(vipSum) / float64(vipCnt) / (float64(nvSum) / float64(nvCnt))
		status := "✅"
		if ratio < 1.5 { status = "⚠️ " }
		fmt.Printf("  %s VIP均值 / 非VIP均值 = %.2f（期望 > 1.5，含非VIP×0.5池内折半）\n", status, ratio)
	}
	fmt.Println()

	// 检测 4：各类型中奖分布
	totalWins := 0
	for _, w := range stats.ArchWins {
		totalWins += w[0] + w[1] + w[2]
	}
	pct := func(n int) string {
		if totalWins == 0 { return "0%" }
		return fmt.Sprintf("%.1f%%", 100.0*float64(n)/float64(totalWins))
	}
	fmt.Println("【检测 4】各类型中奖分布（10,000 场）")
	fmt.Printf("  %-18s  %6s  %6s  %6s  %8s\n", "原型", "第1名", "第2名", "第3名", "合计")
	fmt.Println(" ", sep[:62])
	for _, a := range archetypeOrder {
		w := stats.ArchWins[a]
		total := w[0] + w[1] + w[2]
		fmt.Printf("  %-18s  %6d  %6d  %6d  %6d (%s)\n", a, w[0], w[1], w[2], total, pct(total))
	}
	fmt.Println()
	fmt.Println("  期望：whale_vip >> mid_vip > active_nonvip > casual/inviter > newbie > zero")
	fmt.Println("        第1名只有 whale_vip / mid_vip 有值")
	fmt.Println()

	// 检测 5：个人中奖 TOP 15
	fmt.Println("【检测 5】个人中奖排行 TOP 15")
	type uwin struct {
		name  string
		arch  string
		isVIP bool
		w     [3]int
		total int
	}
	userMap := make(map[string]*User)
	for _, u := range users { userMap[u.Name] = u }
	var ranked []uwin
	for name, w := range stats.UserWins {
		total := w[0] + w[1] + w[2]
		if total == 0 { continue }
		u := userMap[name]
		ranked = append(ranked, uwin{name, u.Archetype, u.isVIP(), w, total})
	}
	sort.Slice(ranked, func(i, j int) bool { return ranked[i].total > ranked[j].total })
	if len(ranked) > 15 { ranked = ranked[:15] }
	fmt.Printf("  %-16s  %-18s  %-5s  %5s  %5s  %5s  %6s\n", "用户", "原型", "VIP", "第1", "第2", "第3", "合计")
	fmt.Println(" ", sep)
	for _, r := range ranked {
		vip := " "
		if r.isVIP { vip = "✓" }
		fmt.Printf("  %-16s  %-18s  %-5s  %5d  %5d  %5d  %6d\n",
			r.name, r.arch, vip, r.w[0], r.w[1], r.w[2], r.total)
	}

	fmt.Println()
	fmt.Println(sep)
	fmt.Printf("  总场次：%d | 总中奖次数：%d | 参与原型数：%d\n",
		stats.TotalDraws, totalWins, len(users))
	fmt.Println(sep)
	fmt.Println()
}
