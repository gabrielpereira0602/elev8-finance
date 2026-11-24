<?php
declare(strict_types=1);

namespace Elev8\Finance;

/**
 * The numbers behind Início and Análises. One place, tested, so the dashboard never inflates spending:
 *  - "Saiu" counts only kind=expense, minus refunds; transfers, invoice payments and investments never count as spending;
 *  - drafts and cancelled rows never count;
 *  - card purchases count in the month their invoice is due (see Ledger).
 */
final class Metrics
{
    private const COUNTED_SQL = "('confirmed','pending','reimbursable','reimbursed')";

    public function __construct(private Db $db, private Purchases $purchases, private Budgets $budgets)
    {
    }

    /** @return array<string,mixed> */
    public function summary(string $userId, string $monthStart): array
    {
        $this->purchases->materializeRecurring($userId, $monthStart);
        $byKind = $this->db->all(
            'SELECT p.kind, i.status, SUM(i.amount_cents) AS cents, COUNT(*) AS n FROM installments i JOIN purchases p ON p.id = i.purchase_id
             WHERE i.user_id = ? AND i.month = ? GROUP BY p.kind, i.status',
            [$userId, $monthStart]
        );
        $sum = fn (array $kinds, ?array $statuses = null) => array_sum(array_map(
            fn ($r) => in_array($r['kind'], $kinds, true) && in_array($r['status'], $statuses ?? Ledger::COUNTED, true) ? (int) $r['cents'] : 0,
            $byKind
        ));
        $income = $sum(['income']);
        $spentGross = $sum(['expense']);
        $refunds = $sum(['refund']);
        $spent = max(0, $spentGross - $refunds);
        $saved = $sum(['saving', 'investment']);
        $pending = $sum(['expense'], ['pending']);
        $reimbursable = $sum(['expense'], ['reimbursable']);
        $drafts = (int) ($this->db->one('SELECT COUNT(*) AS n FROM purchases WHERE user_id = ? AND status = \'draft\'', [$userId])['n'] ?? 0);
        $count = array_sum(array_map(fn ($r) => $r['kind'] === 'expense' && in_array($r['status'], Ledger::COUNTED, true) ? (int) $r['n'] : 0, $byKind));

        $byCategory = $this->db->all(
            'SELECT c.id, c.name, c.grp, SUM(i.amount_cents) AS cents FROM installments i JOIN purchases p ON p.id = i.purchase_id
             LEFT JOIN categories c ON c.id = p.category_id AND c.user_id = p.user_id
             WHERE i.user_id = ? AND i.month = ? AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL . '
             GROUP BY c.id, c.name, c.grp ORDER BY cents DESC',
            [$userId, $monthStart]
        );
        $groups = ['need' => 0, 'want' => 0, 'other' => 0];
        foreach ($byCategory as $c) {
            $g = in_array($c['grp'], ['need', 'want'], true) ? $c['grp'] : 'other';
            $groups[$g] += (int) $c['cents'];
        }
        $byAccount = $this->db->all(
            'SELECT a.id, a.name, a.kind, SUM(i.amount_cents) AS cents FROM installments i JOIN purchases p ON p.id = i.purchase_id
             LEFT JOIN accounts a ON a.id = p.account_id AND a.user_id = p.user_id
             WHERE i.user_id = ? AND i.month = ? AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL . '
             GROUP BY a.id, a.name, a.kind ORDER BY cents DESC',
            [$userId, $monthStart]
        );
        // Day-by-day uses the purchase date of first installments, so a heatmap shows when spending actually happened.
        $daily = $this->db->all(
            'SELECT p.purchase_date AS day, SUM(i.amount_cents) AS cents FROM installments i JOIN purchases p ON p.id = i.purchase_id
             WHERE i.user_id = ? AND i.month = ? AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL . '
             GROUP BY p.purchase_date ORDER BY p.purchase_date',
            [$userId, $monthStart]
        );

        $budget = $this->budgets->forMonth($userId, $monthStart);
        $prevStart = (new \DateTimeImmutable($monthStart, Clock::tz()))->modify('-1 month')->format('Y-m-d');
        $prevSpent = (int) ($this->db->one(
            'SELECT SUM(i.amount_cents) AS s FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE i.user_id = ? AND i.month = ? AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL,
            [$userId, $prevStart]
        )['s'] ?? 0);

        return [
            'month' => substr($monthStart, 0, 7),
            'income_cents' => $income, 'spent_cents' => $spent, 'refunds_cents' => $refunds, 'saved_cents' => $saved,
            'balance_cents' => $income - $spent - $saved,
            'pending_cents' => $pending, 'reimbursable_cents' => $reimbursable, 'drafts' => $drafts,
            'expense_count' => $count, 'average_cents' => $count > 0 ? intdiv($spentGross, $count) : 0,
            'previous_spent_cents' => $prevSpent,
            'budget_cents' => $budget, 'budget_used_pct' => $budget ? round($spent / $budget * 100, 1) : null,
            'groups' => array_map(fn ($c) => (int) $c, $groups),
            'by_category' => array_map(fn ($c) => ['id' => $c['id'], 'name' => $c['name'] ?? 'Sem categoria', 'group' => $c['grp'], 'cents' => (int) $c['cents']], $byCategory),
            'by_account' => array_map(fn ($a) => ['id' => $a['id'], 'name' => $a['name'] ?? 'Sem cartão', 'kind' => $a['kind'], 'cents' => (int) $a['cents']], $byAccount),
            'daily' => array_map(fn ($d) => ['day' => $d['day'], 'cents' => (int) $d['cents']], $daily),
            'can_spend' => $this->canSpend($monthStart, $income, $spent, $saved, $budget),
        ];
    }

    /**
     * "Pode gastar hoje": what is left for the month divided by the days left (today included).
     * Basis is the income registered; without income, the budget; without either, nothing is promised.
     * @return array<string,mixed>
     */
    public function canSpend(string $monthStart, int $income, int $spent, int $saved, ?int $budget): array
    {
        $now = Clock::now();
        if ($now->format('Y-m-01') !== $monthStart) {
            return ['basis' => 'none', 'left_cents' => null, 'per_day_cents' => null, 'days_left' => null];
        }
        $daysLeft = (int) $now->format('t') - (int) $now->format('j') + 1;
        if ($income > 0) {
            $left = $income - $saved - $spent;
            $basis = 'income';
        } elseif ($budget !== null) {
            $left = $budget - $spent;
            $basis = 'budget';
        } else {
            return ['basis' => 'none', 'left_cents' => null, 'per_day_cents' => null, 'days_left' => $daysLeft];
        }
        return ['basis' => $basis, 'left_cents' => $left, 'per_day_cents' => $left > 0 ? intdiv($left, $daysLeft) : 0, 'days_left' => $daysLeft];
    }

    /** Already committed in coming months (installments + recurring), per month and per account. @return list<array<string,mixed>> */
    public function future(string $userId, int $months = 6): array
    {
        $start = Clock::now()->modify('first day of next month');
        $end = $start->modify('+' . ($months - 1) . ' month')->format('Y-m-d');
        $rows = $this->db->all(
            'SELECT i.month, a.name AS account, SUM(i.amount_cents) AS cents FROM installments i JOIN purchases p ON p.id = i.purchase_id
             LEFT JOIN accounts a ON a.id = p.account_id AND a.user_id = p.user_id
             WHERE i.user_id = ? AND i.month BETWEEN ? AND ? AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL . '
             GROUP BY i.month, a.name ORDER BY i.month',
            [$userId, $start->format('Y-m-d'), $end]
        );
        $recurring = (int) ($this->db->one(
            'SELECT SUM(total_cents) AS s FROM purchases WHERE user_id = ? AND recurring = \'monthly\' AND kind = \'expense\' AND status IN ' . self::COUNTED_SQL,
            [$userId]
        )['s'] ?? 0);
        $out = [];
        for ($k = 0; $k < $months; $k++) {
            $m = $start->modify("+$k month")->format('Y-m-d');
            $accounts = [];
            foreach ($rows as $r) {
                if ($r['month'] === $m) {
                    $accounts[] = ['account' => $r['account'] ?? 'Sem cartão', 'cents' => (int) $r['cents']];
                }
            }
            // Recurring rows only exist up to next month; project the rest so the forecast is complete.
            $booked = $this->db->one('SELECT SUM(i.amount_cents) AS s FROM installments i JOIN purchases p ON p.id = i.purchase_id WHERE i.user_id = ? AND i.month = ? AND p.recurring = \'monthly\' AND p.kind = \'expense\' AND i.status IN ' . self::COUNTED_SQL, [$userId, $m]);
            $projected = max(0, $recurring - (int) ($booked['s'] ?? 0));
            $out[] = ['month' => substr($m, 0, 7), 'accounts' => $accounts, 'recurring_projected_cents' => $projected,
                      'total_cents' => array_sum(array_column($accounts, 'cents')) + $projected];
        }
        return $out;
    }

    /** Income vs spending for the last N months, current one included. @return list<array<string,mixed>> */
    public function trend(string $userId, int $months = 6): array
    {
        $first = Clock::now()->modify('first day of this month')->modify('-' . ($months - 1) . ' month');
        $rows = $this->db->all(
            'SELECT i.month, p.kind, SUM(i.amount_cents) AS cents FROM installments i JOIN purchases p ON p.id = i.purchase_id
             WHERE i.user_id = ? AND i.month BETWEEN ? AND ? AND i.status IN ' . self::COUNTED_SQL . ' GROUP BY i.month, p.kind',
            [$userId, $first->format('Y-m-d'), Clock::now()->format('Y-m-01')]
        );
        $out = [];
        for ($k = 0; $k < $months; $k++) {
            $m = $first->modify("+$k month")->format('Y-m-d');
            $get = fn (string $kind) => (int) array_sum(array_map(fn ($r) => $r['month'] === $m && $r['kind'] === $kind ? (int) $r['cents'] : 0, $rows));
            $spent = max(0, $get('expense') - $get('refund'));
            $out[] = ['month' => substr($m, 0, 7), 'income_cents' => $get('income'), 'spent_cents' => $spent, 'saved_cents' => $get('saving') + $get('investment'), 'balance_cents' => $get('income') - $spent];
        }
        return $out;
    }
}
