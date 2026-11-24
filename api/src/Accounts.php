<?php
declare(strict_types=1);

namespace Elev8\Finance;

/** Cards and accounts. Every query is scoped by user_id; another user's id behaves as "not found". */
final class Accounts
{
    public const KINDS = ['credit', 'debit', 'checking', 'cash'];

    public function __construct(private Db $db, private Audit $audit)
    {
    }

    /** @return list<array<string,mixed>> */
    public function list(string $userId, bool $withArchived = false): array
    {
        $rows = $this->db->all(
            'SELECT id, name, kind, closing_day, due_day, archived, sort_order FROM accounts WHERE user_id = ?' . ($withArchived ? '' : ' AND archived = 0') . ' ORDER BY sort_order, name',
            [$userId]
        );
        return array_map([self::class, 'shape'], $rows);
    }

    /** @return array<string,mixed> */
    public function get(string $userId, string $id): array
    {
        $row = $this->db->one('SELECT id, name, kind, closing_day, due_day, archived, sort_order FROM accounts WHERE id = ? AND user_id = ?', [$id, $userId]);
        if ($row === null) {
            throw new HttpError(404, 'not_found', 'Cartão ou conta não encontrado.');
        }
        return self::shape($row);
    }

    /** @param array<string,mixed> $in @return array<string,mixed> */
    public function create(string $userId, array $in): array
    {
        $name = Validate::str($in, 'name', 60, true);
        $kind = Validate::oneOf($in, 'kind', self::KINDS);
        [$closing, $due] = $this->days($in, $kind);
        $count = (int) ($this->db->one('SELECT COUNT(*) AS n FROM accounts WHERE user_id = ?', [$userId])['n'] ?? 0);
        if ($count >= 30) {
            throw new HttpError(422, 'limit_reached', 'Limite de 30 cartões e contas no beta.');
        }
        $id = Id::new();
        $this->db->run(
            'INSERT INTO accounts (id, user_id, name, kind, closing_day, due_day, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [$id, $userId, $name, $kind, $closing, $due, $count, Clock::sql(), Clock::sql()]
        );
        $this->audit->log($userId, 'account_created', 'account', $id);
        return $this->get($userId, $id);
    }

    /**
     * Changing closing/due days does not move installments already booked: past invoices are history.
     * @param array<string,mixed> $in @return array<string,mixed>
     */
    public function update(string $userId, string $id, array $in): array
    {
        $cur = $this->get($userId, $id);
        $name = array_key_exists('name', $in) ? Validate::str($in, 'name', 60, true) : $cur['name'];
        $kind = array_key_exists('kind', $in) ? Validate::oneOf($in, 'kind', self::KINDS) : $cur['kind'];
        [$closing, $due] = $this->days($in + ['closing_day' => $cur['closing_day'], 'due_day' => $cur['due_day']], $kind);
        $archived = array_key_exists('archived', $in) ? (bool) $in['archived'] : $cur['archived'];
        $sort = Validate::int($in, 'sort_order', 0, 999, $cur['sort_order']);
        $this->db->run(
            'UPDATE accounts SET name = ?, kind = ?, closing_day = ?, due_day = ?, archived = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?',
            [$name, $kind, $closing, $due, $archived ? 1 : 0, $sort, Clock::sql(), $id, $userId]
        );
        $this->audit->log($userId, 'account_updated', 'account', $id);
        return $this->get($userId, $id);
    }

    /** @param array<string,mixed> $in @return array{0:?int,1:?int} */
    private function days(array $in, string $kind): array
    {
        if ($kind !== 'credit') {
            return [null, null];
        }
        $closing = Validate::int($in, 'closing_day', 1, 31);
        $due = Validate::int($in, 'due_day', 1, 31);
        if ($closing === null || $due === null) {
            throw new HttpError(422, 'card_days_required', 'Para cartão de crédito, informe o dia do fechamento e o do vencimento.');
        }
        if ($closing === $due) {
            throw new HttpError(422, 'card_days_equal', 'Fechamento e vencimento não podem cair no mesmo dia.');
        }
        return [$closing, $due];
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private static function shape(array $r): array
    {
        return [
            'id' => $r['id'], 'name' => $r['name'], 'kind' => $r['kind'],
            'closing_day' => $r['closing_day'] === null ? null : (int) $r['closing_day'],
            'due_day' => $r['due_day'] === null ? null : (int) $r['due_day'],
            'archived' => (bool) $r['archived'], 'sort_order' => (int) $r['sort_order'],
        ];
    }
}
