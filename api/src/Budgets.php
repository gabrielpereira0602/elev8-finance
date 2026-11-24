<?php
declare(strict_types=1);

namespace Elev8\Finance;

/** Monthly budget. A month without its own value inherits the most recent earlier one. */
final class Budgets
{
    public function __construct(private Db $db, private Audit $audit)
    {
    }

    public function forMonth(string $userId, string $monthStart): ?int
    {
        $row = $this->db->one('SELECT amount_cents FROM budgets WHERE user_id = ? AND month <= ? ORDER BY month DESC LIMIT 1', [$userId, $monthStart]);
        return $row === null ? null : (int) $row['amount_cents'];
    }

    public function set(string $userId, string $monthStart, int $cents): void
    {
        if ($cents < 0 || $cents > Validate::MAX_CENTS) {
            throw new HttpError(422, 'invalid_amount', 'Orçamento inválido.');
        }
        $this->db->run(
            'INSERT INTO budgets (user_id, month, amount_cents, updated_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE amount_cents = VALUES(amount_cents), updated_at = VALUES(updated_at)',
            [$userId, $monthStart, $cents, Clock::sql()]
        );
        $this->audit->log($userId, 'budget_set');
    }
}
