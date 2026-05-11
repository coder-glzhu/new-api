// lucky_bag_sim — 100-case Monte-Carlo simulation of the new lucky bag weight algorithm.
// Run:  go run ./scripts/lucky_bag_sim/
//
// Simulates realistic user archetypes, picks random participant pools, runs 100 draws,
// and prints a health report: win-rate by archetype, 1st/2nd/3rd place distribution,
// VIP privilege check, blank-user 1st-place block, and consecutive-win penalty.
package main

import (
	"fmt"
	"math"
	"math/rand"
	"sort"
	"strings"
	"time"
)

// ── user archetypes ─────────────────────────────────────────────────────────

type User struct {
	ID          int
	Name        string
	Archetype   string
	Group       string // "default" | "vip" | "svip"
	Quota30d    int64  // token quota consumed in last 30 days
	Invites     int    // total invites
	Checkins    int    // checkins in last 30 days
	LBEntries   int    // total lucky-bag entries
	EverSpent   bool   // has any consumption at all
	// runtime state
	RecentWins  []bool // last N draw outcomes (true=won any rank)
}

func (u *User) isVIP() bool { return u.Group == "vip" || u.Group == "svip" }

func (u *User) isBlank() bool {
	return !u.EverSpent && !u.isVIP()
}

// ── weight calculation (mirrors model/lucky_bag.go) ─────────────────────────

const (
	floorTickets   = 10
	meritCap       = 40
	meritBonus     = 5.0
	vipMult        = 1.5
	pityStep       = 0.2
	pityCap        = 10
	winPenaltyStep = 0.5
	winLookback    = 5
)

func calcScore(u *User) float64 {
	score := math.Log2(1+float64(u.Quota30d)/10000) +
		0.8*math.Log2(1+float64(u.Invites)*5) +
		0.3*float64(u.Checkins) +
		0.15*math.Log2(1+float64(u.LBEntries))
	return score
}

func calcPityLosses(u *User) int {
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

func calcRecentWins(u *User) int {
	lookback := winLookback
	if len(u.RecentWins) < lookback {
		lookback = len(u.RecentWins)
	}
	wins := 0
	for _, w := range u.RecentWins[len(u.RecentWins)-lookback:] {
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
	if merit > meritCap {
		merit = meritCap
	}
	base := float64(floorTickets) + merit

	vipM := 1.0
	if u.isVIP() {
		vipM = vipMult
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

// ── draw simulation ─────────────────────────────────────────────────────────

type DrawResult struct {
	Winners [3]*User // nil if no winner for that rank
	Quotas  [3]int
}

// quotaRange returns [min,max] for rank 1/2/3 given activity [minQ,maxQ]
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

func weightedPick(pool []*User) (*User, []*User) {
	total := 0
	for _, u := range pool {
		total += calcWeight(u)
	}
	pick := rand.Intn(total)
	cum := 0
	for i, u := range pool {
		cum += calcWeight(u)
		if pick < cum {
			remaining := append(append([]*User{}, pool[:i]...), pool[i+1:]...)
			return u, remaining
		}
	}
	return pool[len(pool)-1], pool[:len(pool)-1]
}

func simulate(participants []*User, minQ, maxQ int) DrawResult {
	pool := make([]*User, len(participants))
	copy(pool, participants)

	var result DrawResult

	for rank := 1; rank <= 3 && len(pool) > 0; rank++ {
		candidate, remaining := weightedPick(pool)

		// 1st place: build non-blank pool and re-pick from it
		if rank == 1 && candidate.isBlank() {
			var nonBlankPool []*User
			for _, u := range pool {
				if !u.isBlank() {
					nonBlankPool = append(nonBlankPool, u)
				}
			}
			if len(nonBlankPool) > 0 {
				candidate, _ = weightedPick(nonBlankPool)
				remaining = make([]*User, 0, len(pool)-1)
				for _, u := range pool {
					if u.ID != candidate.ID {
						remaining = append(remaining, u)
					}
				}
			}
			// if nonBlankPool empty: all blanks — allow it
		}

		lo, hi := quotaRange(minQ, maxQ, rank)
		result.Winners[rank-1] = candidate
		result.Quotas[rank-1] = randQuota(lo, hi)
		pool = remaining
	}
	return result
}

// ── archetype factory ────────────────────────────────────────────────────────

func makeUsers() []*User {
	id := 1
	next := func() int { id++; return id }

	users := []*User{
		// Heavy whales (VIP, high 30d spend)
		{ID: next(), Name: "Whale-VIP-1", Archetype: "whale_vip", Group: "vip", Quota30d: 50_000_000, Invites: 10, Checkins: 28, LBEntries: 60, EverSpent: true},
		{ID: next(), Name: "Whale-VIP-2", Archetype: "whale_vip", Group: "vip", Quota30d: 38_000_000, Invites: 5, Checkins: 25, LBEntries: 40, EverSpent: true},
		{ID: next(), Name: "Whale-VIP-3", Archetype: "whale_vip", Group: "svip", Quota30d: 80_000_000, Invites: 20, Checkins: 30, LBEntries: 90, EverSpent: true},

		// Mid-tier VIP
		{ID: next(), Name: "Mid-VIP-1", Archetype: "mid_vip", Group: "vip", Quota30d: 5_000_000, Invites: 3, Checkins: 20, LBEntries: 30, EverSpent: true},
		{ID: next(), Name: "Mid-VIP-2", Archetype: "mid_vip", Group: "vip", Quota30d: 3_000_000, Invites: 1, Checkins: 15, LBEntries: 20, EverSpent: true},
		{ID: next(), Name: "Mid-VIP-3", Archetype: "mid_vip", Group: "vip", Quota30d: 8_000_000, Invites: 7, Checkins: 22, LBEntries: 35, EverSpent: true},

		// Active non-VIP (heavy spenders without VIP tag)
		{ID: next(), Name: "Active-1", Archetype: "active", Group: "default", Quota30d: 4_000_000, Invites: 2, Checkins: 18, LBEntries: 25, EverSpent: true},
		{ID: next(), Name: "Active-2", Archetype: "active", Group: "default", Quota30d: 2_500_000, Invites: 0, Checkins: 12, LBEntries: 15, EverSpent: true},
		{ID: next(), Name: "Active-3", Archetype: "active", Group: "default", Quota30d: 6_000_000, Invites: 4, Checkins: 24, LBEntries: 45, EverSpent: true},
		{ID: next(), Name: "Active-4", Archetype: "active", Group: "default", Quota30d: 1_200_000, Invites: 1, Checkins: 10, LBEntries: 20, EverSpent: true},

		// Casual users (small spend)
		{ID: next(), Name: "Casual-1", Archetype: "casual", Group: "default", Quota30d: 200_000, Invites: 0, Checkins: 5, LBEntries: 8, EverSpent: true},
		{ID: next(), Name: "Casual-2", Archetype: "casual", Group: "default", Quota30d: 100_000, Invites: 0, Checkins: 3, LBEntries: 5, EverSpent: true},
		{ID: next(), Name: "Casual-3", Archetype: "casual", Group: "default", Quota30d: 50_000, Invites: 0, Checkins: 2, LBEntries: 3, EverSpent: true},
		{ID: next(), Name: "Casual-4", Archetype: "casual", Group: "default", Quota30d: 300_000, Invites: 1, Checkins: 8, LBEntries: 10, EverSpent: true},
		{ID: next(), Name: "Casual-5", Archetype: "casual", Group: "default", Quota30d: 80_000, Invites: 0, Checkins: 4, LBEntries: 6, EverSpent: true},

		// Inviters (low spend but lots of referrals)
		{ID: next(), Name: "Inviter-1", Archetype: "inviter", Group: "default", Quota30d: 100_000, Invites: 15, Checkins: 20, LBEntries: 30, EverSpent: true},
		{ID: next(), Name: "Inviter-2", Archetype: "inviter", Group: "default", Quota30d: 50_000, Invites: 8, Checkins: 15, LBEntries: 20, EverSpent: true},

		// Newbies who spend (not blank)
		{ID: next(), Name: "Newbie-Spent-1", Archetype: "newbie_spent", Group: "default", Quota30d: 10_000, Invites: 0, Checkins: 1, LBEntries: 1, EverSpent: true},
		{ID: next(), Name: "Newbie-Spent-2", Archetype: "newbie_spent", Group: "default", Quota30d: 5_000, Invites: 0, Checkins: 0, LBEntries: 1, EverSpent: true},

		// Blank users (no spend, no VIP) — should NEVER get 1st place
		{ID: next(), Name: "Blank-1", Archetype: "blank", Group: "default", Quota30d: 0, Invites: 0, Checkins: 2, LBEntries: 5, EverSpent: false},
		{ID: next(), Name: "Blank-2", Archetype: "blank", Group: "default", Quota30d: 0, Invites: 0, Checkins: 0, LBEntries: 1, EverSpent: false},
		{ID: next(), Name: "Blank-3", Archetype: "blank", Group: "default", Quota30d: 0, Invites: 0, Checkins: 5, LBEntries: 10, EverSpent: false},
		{ID: next(), Name: "Blank-4", Archetype: "blank", Group: "default", Quota30d: 0, Invites: 1, Checkins: 8, LBEntries: 15, EverSpent: false},

		// UID-41 lookalike: old user with historical spend but 0 last-30d
		{ID: 41, Name: "UID41-OldWhale", Archetype: "old_whale", Group: "default", Quota30d: 0, Invites: 3, Checkins: 10, LBEntries: 20, EverSpent: true},
	}
	return users
}

// ── stats ────────────────────────────────────────────────────────────────────

type Stats struct {
	TotalDraws   int
	WinsByUser   map[string][3]int // [rank1, rank2, rank3]
	ArchWins     map[string][3]int
	BlankFirst   int // times a blank user got 1st — MUST be 0
	ConsecWin2   int // cases where same user won 2 draws in a row
	ConsecWin3   int
	MinWt        map[string]int
	MaxWt        map[string]int
	AvgWt        map[string]float64
	WtCount      map[string]int
}

func newStats(users []*User) *Stats {
	s := &Stats{
		WinsByUser: make(map[string][3]int),
		ArchWins:   make(map[string][3]int),
		MinWt:      make(map[string]int),
		MaxWt:      make(map[string]int),
		AvgWt:      make(map[string]float64),
		WtCount:    make(map[string]int),
	}
	for _, u := range users {
		s.MinWt[u.Archetype] = 9999
	}
	return s
}

func (s *Stats) recordWeight(u *User, w int) {
	a := u.Archetype
	if w < s.MinWt[a] {
		s.MinWt[a] = w
	}
	if w > s.MaxWt[a] {
		s.MaxWt[a] = w
	}
	s.AvgWt[a] += float64(w)
	s.WtCount[a]++
}

func (s *Stats) recordWin(u *User, rank int) {
	w := s.WinsByUser[u.Name]
	w[rank-1]++
	s.WinsByUser[u.Name] = w
	a := s.ArchWins[u.Archetype]
	a[rank-1]++
	s.ArchWins[u.Archetype] = a
	if rank == 1 && u.isBlank() {
		s.BlankFirst++
	}
}

// ── main ─────────────────────────────────────────────────────────────────────

func main() {
	rand.Seed(time.Now().UnixNano())

	users := makeUsers()
	allUsers := users
	stats := newStats(users)

	const cases = 100
	const minQ = 500_000  // $1
	const maxQ = 5_000_000 // $10

	// Track last winner per rank across draws for consecutive-win detection
	lastWinner := [3]*User{}

	for c := 0; c < cases; c++ {
		// Random participant count: 3 to len(users)
		nPart := 3 + rand.Intn(len(allUsers)-2)
		// Shuffle and pick nPart users
		shuffled := make([]*User, len(allUsers))
		copy(shuffled, allUsers)
		rand.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })
		participants := shuffled[:nPart]

		// Record weights before draw
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

			// Consecutive win detection
			if lastWinner[rank] != nil && lastWinner[rank].ID == winner.ID {
				if rank == 0 {
					stats.ConsecWin2++
				} else {
					stats.ConsecWin3++
				}
			}
			lastWinner[rank] = winner

			// Update winner's recent history
			winner.RecentWins = append(winner.RecentWins, true)
		}
		// Update losers' history
		winnerIDs := map[int]bool{}
		for _, w := range result.Winners {
			if w != nil {
				winnerIDs[w.ID] = true
			}
		}
		for _, u := range participants {
			if !winnerIDs[u.ID] {
				u.RecentWins = append(u.RecentWins, false)
				// cap history length
				if len(u.RecentWins) > 20 {
					u.RecentWins = u.RecentWins[1:]
				}
			}
		}
	}

	// ── print report ──────────────────────────────────────────────────────────

	sep := strings.Repeat("─", 72)
	fmt.Println()
	fmt.Println("╔══════════════════════════════════════════════════════════════════════╗")
	fmt.Println("║            Lucky Bag Algorithm Health Report  (100 cases)           ║")
	fmt.Println("╚══════════════════════════════════════════════════════════════════════╝")
	fmt.Println()

	// 1. SAFETY CHECK: blank user 1st-place violations
	fmt.Println("▶ SAFETY CHECK: Blank-user 1st-place violations")
	if stats.BlankFirst == 0 {
		fmt.Println("  ✅ PASS — no blank user ever won 1st place")
	} else {
		fmt.Printf("  ❌ FAIL — %d violation(s)! Blank user(s) won 1st place\n", stats.BlankFirst)
	}
	fmt.Println()

	// 2. WEIGHT PROFILE by archetype
	fmt.Println("▶ WEIGHT PROFILE by archetype")
	fmt.Printf("  %-18s  %5s  %5s  %6s\n", "Archetype", "Min", "Max", "Avg")
	fmt.Println(" ", sep[:62])
	archetypes := []string{"whale_vip", "mid_vip", "active", "inviter", "casual", "newbie_spent", "old_whale", "blank"}
	for _, a := range archetypes {
		cnt := stats.WtCount[a]
		if cnt == 0 {
			continue
		}
		avg := stats.AvgWt[a] / float64(cnt)
		fmt.Printf("  %-18s  %5d  %5d  %6.1f\n", a, stats.MinWt[a], stats.MaxWt[a], avg)
	}
	fmt.Println()
	fmt.Println("  Expected order: whale_vip > mid_vip > active ≈ inviter > casual > newbie_spent > old_whale ≈ blank")
	fmt.Println()

	// 3. WIN DISTRIBUTION by archetype (1st / 2nd / 3rd)
	fmt.Println("▶ WIN DISTRIBUTION by archetype  (1st / 2nd / 3rd  out of 100 draws)")
	fmt.Printf("  %-18s  %6s  %6s  %6s  %8s\n", "Archetype", "1st", "2nd", "3rd", "Total")
	fmt.Println(" ", sep[:60])
	totalByArch := map[string]int{}
	for a, w := range stats.ArchWins {
		totalByArch[a] = w[0] + w[1] + w[2]
	}
	for _, a := range archetypes {
		w := stats.ArchWins[a]
		total := w[0] + w[1] + w[2]
		fmt.Printf("  %-18s  %6d  %6d  %6d  %8d\n", a, w[0], w[1], w[2], total)
	}
	fmt.Println()

	// 4. HEALTH RATIOS
	fmt.Println("▶ HEALTH RATIOS")
	vipWins := stats.ArchWins["whale_vip"][0] + stats.ArchWins["whale_vip"][1] + stats.ArchWins["whale_vip"][2] +
		stats.ArchWins["mid_vip"][0] + stats.ArchWins["mid_vip"][1] + stats.ArchWins["mid_vip"][2]
	nonVipActiveWins := stats.ArchWins["active"][0] + stats.ArchWins["active"][1] + stats.ArchWins["active"][2]
	casualWins := stats.ArchWins["casual"][0] + stats.ArchWins["casual"][1] + stats.ArchWins["casual"][2]
	blankWins := stats.ArchWins["blank"][0] + stats.ArchWins["blank"][1] + stats.ArchWins["blank"][2]
	oldWhaleWins := stats.ArchWins["old_whale"][0] + stats.ArchWins["old_whale"][1] + stats.ArchWins["old_whale"][2]
	totalWins := 0
	for _, w := range stats.ArchWins {
		totalWins += w[0] + w[1] + w[2]
	}

	pct := func(n int) string {
		if totalWins == 0 {
			return "0%"
		}
		return fmt.Sprintf("%.1f%%", 100.0*float64(n)/float64(totalWins))
	}
	fmt.Printf("  VIP total wins:          %3d  (%s)\n", vipWins, pct(vipWins))
	fmt.Printf("  Active non-VIP wins:     %3d  (%s)\n", nonVipActiveWins, pct(nonVipActiveWins))
	fmt.Printf("  Casual wins:             %3d  (%s)\n", casualWins, pct(casualWins))
	fmt.Printf("  Blank user wins (2nd/3rd):%2d  (%s)\n", blankWins, pct(blankWins))
	fmt.Printf("  UID-41 old-whale wins:   %3d  (%s)\n", oldWhaleWins, pct(oldWhaleWins))
	fmt.Println()
	fmt.Println("  Expected: VIP > Active > Casual >> Blank(no 1st); old_whale ≈ casual (low 30d spend)")

	// 5. CONSECUTIVE WIN ANALYSIS
	fmt.Println()
	fmt.Println("▶ CONSECUTIVE WIN DETECTION (same user wins same rank 2 draws in a row)")
	fmt.Printf("  1st-place repeats: %d / %d\n", stats.ConsecWin2, cases-1)
	fmt.Printf("  2nd/3rd repeats:   %d / %d\n", stats.ConsecWin3, cases-1)
	if float64(stats.ConsecWin2)/float64(cases-1) < 0.15 {
		fmt.Println("  ✅ Consecutive 1st-place rate < 15% (penalty working)")
	} else {
		fmt.Println("  ⚠️  Consecutive 1st-place rate ≥ 15% — penalty may need tuning")
	}

	// 6. PER-USER detailed wins (top 10)
	fmt.Println()
	fmt.Println("▶ TOP WINNERS (by total wins across all ranks)")
	type uwin struct {
		name string
		arch string
		w    [3]int
	}
	var ranked []uwin
	for name, w := range stats.WinsByUser {
		total := w[0] + w[1] + w[2]
		if total > 0 {
			arch := ""
			for _, u := range allUsers {
				if u.Name == name {
					arch = u.Archetype
					break
				}
			}
			ranked = append(ranked, uwin{name, arch, w})
		}
	}
	sort.Slice(ranked, func(i, j int) bool {
		ti := ranked[i].w[0] + ranked[i].w[1] + ranked[i].w[2]
		tj := ranked[j].w[0] + ranked[j].w[1] + ranked[j].w[2]
		return ti > tj
	})
	limit := 10
	if len(ranked) < limit {
		limit = len(ranked)
	}
	fmt.Printf("  %-22s  %-14s  %5s  %5s  %5s  %7s\n", "Name", "Archetype", "1st", "2nd", "3rd", "Total")
	fmt.Println(" ", sep[:66])
	for _, r := range ranked[:limit] {
		total := r.w[0] + r.w[1] + r.w[2]
		fmt.Printf("  %-22s  %-14s  %5d  %5d  %5d  %7d\n", r.name, r.arch, r.w[0], r.w[1], r.w[2], total)
	}

	fmt.Println()
	fmt.Println(sep)
	fmt.Printf("  Total draws: %d | Total prize slots: %d\n", stats.TotalDraws, totalWins)
	fmt.Println(sep)
	fmt.Println()
}
