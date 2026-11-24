<?php
declare(strict_types=1);

namespace Elev8\Finance;

/**
 * Purchases (compra-mãe) and their installments.
 * - Retries are safe: the app sends an idempotency key per draft; the same key never creates a second purchase.
 * - A likely duplicate (same value, day and place within 10 minutes, different key) is refused unless confirmed.
 * - Free text is encrypted; the merchant is also stored as a keyed hash so suggestions can learn without plain text.
 */
final class Purchases
{
    public const KINDS = ['expense', 'income', 'saving', 'transfer', 'invoice_payment', 'refund', 'investment'];
    public const STATUSES = ['draft', 'confirmed', 'pending', 'reimbursable', 'reimbursed', 'cancelled'];
    public const ORIGINS = ['manual', 'text', 'voice', 'import'];

    public function __construct(private Db $db, private Audit $audit, private Crypto $crypto, private Accounts $accounts, private Categories $categories)
    {
    }

    /** @param array<string,mixed> $in @return array{purchase: array<string,mixed>, replayed: bool} */
    public function create(string $userId, array $in): array
    {
        $key = $in['idempotency_key'] ?? null;
        if (!is_string($key) || preg_match('/^[A-Za-z0-9_-]{8,64}$/', $key) !== 1) {
            throw new HttpError(422, 'missing_idempotency_key', 'Falta a chave de idempotência do lançamento.');
        }
        $existing = $this->db->one('SELECT id FROM purchases WHERE user_id = ? AND idempotency_key = ?', [$userId, $key]);
        if ($existing !== null) {
            return ['purchase' => $this->get($userId, $existing['id']), 'replayed' => true];
        }

        $kind = Validate::oneOf($in, 'kind', self::KINDS, 'expense');
        $status = Validate::oneOf($in, 'status', ['draft', 'confirmed', 'pending', 'reimbursable'], 'draft');
        $origin = Validate::oneOf($in, 'origin', self::ORIGINS, 'manual');
        $total = Validate::cents($in, 'total_cents');
        $date = Validate::date($in, 'purchase_date');
        $n = Validate::int($in, 'installments', 1, Validate::MAX_INSTALLMENTS, 1) ?? 1;
        $recurring = Validate::oneOf($in, 'recurring', ['none', 'monthly'], 'none');
        if ($n > 1 && $recurring !== 'none') {
            throw new HttpError(422, 'installments_and_recurring', 'Um lançamento não pode ser parcelado e recorrente ao mesmo tempo.');
        }
        if ($n > 1 && $kind !== 'expense') {
            throw new HttpError(422, 'installments_only_expense', 'Só gastos podem ser parcelados.');
        }
        if ($n > 1 && $total < $n) {
            throw new HttpError(422, 'installment_too_small', 'O valor é pequeno demais para tantas parcelas.');
        }
        $account = $this->ownedAccount($userId, Validate::id($in, 'account_id'));
        $categoryId = $this->ownedCategory($userId, Validate::id($in, 'category_id'), $kind);
        $description = Validate::str($in, 'description', 140);
        $merchant = Validate::str($in, 'merchant', 80);
        $notes = Validate::str($in, 'notes', 500);
        $tags = self::tags($in['tags'] ?? []);
        $merchantKey = $merchant !== null ? $this->crypto->keyed(Categories::normalize($merchant)) : null;

        if (($in['allow_duplicate'] ?? false) !== true) {
            $this->guardDuplicate($userId, $total, $date, $merchantKey);
        }

        $id = Id::new();
        $this->db->tx(function () use ($id, $userId, $kind, $status, $origin, $total, $date, $account, $categoryId, $n, $recurring, $description, $merchant, $merchantKey, $notes, $tags, $key) {
            $this->db->run(
                'INSERT INTO purchases (id, user_id, kind, status, origin, total_cents, currency, purchase_date, account_id, category_id, installments_total, recurring,
                   description_enc, merchant_enc, merchant_key, notes_enc, tags_enc, idempotency_key, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, \'BRL\', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [$id, $userId, $kind, $status, $origin, $total, $date, $account['id'] ?? null, $categoryId, $n, $recurring,
                 $this->crypto->encrypt($description), $this->crypto->encrypt($merchant), $merchantKey, $this->crypto->encrypt($notes),
                 $this->crypto->encrypt($tags === [] ? null : json_encode($tags, JSON_UNESCAPED_UNICODE)), $key, Clock::sql(), Clock::sql()]
            );
            $this->writeSchedule($userId, $id, $total, $n, $date, $account, $status);
            if ($categoryId !== null && $status !== 'draft') {
                $this->categories->learn($userId, $merchant ?? $description, $categoryId);
            }
        });
        $this->audit->log($userId, 'purchase_created', 'purchase', $id);
        return ['purchase' => $this->get($userId, $id), 'replayed' => false];
    }

    public function confirm(string $userId, string $id): array
    {
        $p = $this->get($userId, $id);
        if ($p['status'] !== 'draft') {
            return $p; // confirming twice is harmless
        }
        $this->db->tx(function () use ($userId, $id, $p) {
            $this->db->run('UPDATE purchases SET status = \'confirmed\', updated_at = ? WHERE id = ? AND user_id = ?', [Clock::sql(), $id, $userId]);
            $this->db->run('UPDATE installments SET status = \'confirmed\', updated_at = ? WHERE purchase_id = ? AND user_id = ? AND status = \'draft\'', [Clock::sql(), $id, $userId]);
            if ($p['category_id'] !== null) {
                $this->categories->learn($userId, $p['merchant'] ?? $p['description'], $p['category_id']);
            }
        });
        $this->audit->log($userId, 'purchase_confirmed', 'purchase', $id);
        return $this->get($userId, $id);
    }

    /**
     * Edits. Changing value, date, card or number of installments rebuilds the schedule;
     * other fields (text, category, tags, status) keep it.
     * @param array<string,mixed> $in @return array<string,mixed>
     */
    public function update(string $userId, string $id, array $in): array
    {
        $cur = $this->get($userId, $id);
        if ($cur['status'] === 'cancelled') {
            throw new HttpError(409, 'cancelled', 'Este lançamento foi cancelado.');
        }
        $kind = array_key_exists('kind', $in) ? Validate::oneOf($in, 'kind', self::KINDS) : $cur['kind'];
        $total = array_key_exists('total_cents', $in) ? Validate::cents($in, 'total_cents') : $cur['total_cents'];
        $date = array_key_exists('purchase_date', $in) ? Validate::date($in, 'purchase_date') : $cur['purchase_date'];
        $n = array_key_exists('installments', $in) ? (Validate::int($in, 'installments', 1, Validate::MAX_INSTALLMENTS) ?? 1) : $cur['installments_total'];
        $recurring = array_key_exists('recurring', $in) ? Validate::oneOf($in, 'recurring', ['none', 'monthly']) : $cur['recurring'];
        if ($n > 1 && ($recurring !== 'none' || $kind !== 'expense')) {
            throw new HttpError(422, 'installments_only_expense', 'Só gastos não recorrentes podem ser parcelados.');
        }
        $accountId = array_key_exists('account_id', $in) ? Validate::id($in, 'account_id') : $cur['account_id'];
        $account = $this->ownedAccount($userId, $accountId);
        $categoryId = array_key_exists('category_id', $in) ? $this->ownedCategory($userId, Validate::id($in, 'category_id'), $kind) : $cur['category_id'];
        $status = array_key_exists('status', $in) ? Validate::oneOf($in, 'status', ['draft', 'confirmed', 'pending', 'reimbursable', 'reimbursed']) : $cur['status'];
        $description = array_key_exists('description', $in) ? Validate::str($in, 'description', 140) : $cur['description'];
        $merchant = array_key_exists('merchant', $in) ? Validate::str($in, 'merchant', 80) : $cur['merchant'];
        $notes = array_key_exists('notes', $in) ? Validate::str($in, 'notes', 500) : $cur['notes'];
        $tags = array_key_exists('tags', $in) ? self::tags($in['tags']) : $cur['tags'];
        $rebuild = $total !== $cur['total_cents'] || $date !== $cur['purchase_date'] || $n !== $cur['installments_total'] || $accountId !== $cur['account_id'];

        $this->db->tx(function () use ($userId, $id, $kind, $status, $total, $date, $account, $categoryId, $n, $recurring, $description, $merchant, $notes, $tags, $rebuild, $cur) {
            $this->db->run(
                'UPDATE purchases SET kind = ?, status = ?, total_cents = ?, purchase_date = ?, account_id = ?, category_id = ?, installments_total = ?, recurring = ?,
                   description_enc = ?, merchant_enc = ?, merchant_key = ?, notes_enc = ?, tags_enc = ?, updated_at = ? WHERE id = ? AND user_id = ?',
                [$kind, $status, $total, $date, $account['id'] ?? null, $categoryId, $n, $recurring,
                 $this->crypto->encrypt($description), $this->crypto->encrypt($merchant), $merchant !== null ? $this->crypto->keyed(Categories::normalize($merchant)) : null,
                 $this->crypto->encrypt($notes), $this->crypto->encrypt($tags === [] ? null : json_encode($tags, JSON_UNESCAPED_UNICODE)), Clock::sql(), $id, $userId]
            );
            if ($rebuild) {
                $this->db->run('DELETE FROM installments WHERE purchase_id = ? AND user_id = ?', [$id, $userId]);
                $this->writeSchedule($userId, $id, $total, $n, $date, $account, $status);
            } else {
                $this->db->run('UPDATE installments SET status = ?, updated_at = ? WHERE purchase_id = ? AND user_id = ? AND status <> \'cancelled\'', [$status, Clock::sql(), $id, $userId]);
            }
            if ($categoryId !== null && $categoryId !== $cur['category_id'] && $status !== 'draft') {
                $this->categories->learn($userId, $merchant ?? $description, $categoryId);
            }
        });
        $this->audit->log($userId, 'purchase_updated', 'purchase', $id);
        return $this->get($userId, $id);
    }

    /** Change one installment's value; the purchase total follows so the two never disagree. */
    public function updateInstallment(string $userId, string $purchaseId, int $seq, int $amountCents): array
    {
        $p = $this->get($userId, $purchaseId);
        if ($amountCents < Validate::MIN_CENTS || $amountCents > Validate::MAX_CENTS) {
            throw new HttpError(422, 'invalid_amount', 'Valor inválido.');
        }
        $this->db->tx(function () use ($userId, $purchaseId, $seq, $amountCents) {
            $n = $this->db->run('UPDATE installments SET amount_cents = ?, updated_at = ? WHERE purchase_id = ? AND user_id = ? AND seq = ? AND status <> \'cancelled\'', [$amountCents, Clock::sql(), $purchaseId, $userId, $seq])->rowCount();
            if ($n === 0) {
                throw new HttpError(404, 'not_found', 'Parcela não encontrada.');
            }
            $sum = (int) $this->db->one('SELECT SUM(amount_cents) AS s FROM installments WHERE purchase_id = ? AND user_id = ?', [$purchaseId, $userId])['s'];
            $this->db->run('UPDATE purchases SET total_cents = ?, updated_at = ? WHERE id = ? AND user_id = ?', [$sum, Clock::sql(), $purchaseId, $userId]);
        });
        $this->audit->log($userId, 'installment_updated', 'purchase', $p['id']);
        return $this->get($userId, $purchaseId);
    }

    /**
     * Cancel. scope "all": the whole purchase and every installment.
     * scope "future": only installments in months after the current one (e.g. a subscription that ended).
     */
    public function cancel(string $userId, string $id, string $scope): array
    {
        $this->get($userId, $id);
        $thisMonth = Clock::now()->format('Y-m-01');
        $this->db->tx(function () use ($userId, $id, $scope, $thisMonth) {
            if ($scope === 'all') {
                $this->db->run('UPDATE purchases SET status = \'cancelled\', updated_at = ? WHERE id = ? AND user_id = ?', [Clock::sql(), $id, $userId]);
                $this->db->run('UPDATE installments SET status = \'cancelled\', updated_at = ? WHERE purchase_id = ? AND user_id = ?', [Clock::sql(), $id, $userId]);
            } elseif ($scope === 'future') {
                $this->db->run('UPDATE installments SET status = \'cancelled\', updated_at = ? WHERE purchase_id = ? AND user_id = ? AND month > ?', [Clock::sql(), $id, $userId, $thisMonth]);
                $this->db->run('UPDATE purchases SET recurring = \'none\', updated_at = ? WHERE id = ? AND user_id = ?', [Clock::sql(), $id, $userId]);
            } else {
                throw new HttpError(422, 'invalid_scope', 'Escolha cancelar tudo ou só as próximas parcelas.');
            }
        });
        $this->audit->log($userId, 'purchase_cancelled_' . $scope, 'purchase', $id);
        return $this->get($userId, $id);
    }

    /** What a cancel would do, so the app can show it before asking for confirmation. @return array<string,int> */
    public function cancelPreview(string $userId, string $id): array
    {
        $this->get($userId, $id);
        $thisMonth = Clock::now()->format('Y-m-01');
        $rows = $this->db->all('SELECT month, amount_cents FROM installments WHERE purchase_id = ? AND user_id = ? AND status <> \'cancelled\'', [$id, $userId]);
        $future = array_filter($rows, fn ($r) => $r['month'] > $thisMonth);
        return [
            'all_count' => count($rows), 'all_cents' => array_sum(array_map(fn ($r) => (int) $r['amount_cents'], $rows)),
            'future_count' => count($future), 'future_cents' => array_sum(array_map(fn ($r) => (int) $r['amount_cents'], $future)),
        ];
    }

    public function delete(string $userId, string $id): void
    {
        $n = $this->db->run('DELETE FROM purchases WHERE id = ? AND user_id = ?', [$id, $userId])->rowCount();
        if ($n === 0) {
            throw new HttpError(404, 'not_found', 'Lançamento não encontrado.');
        }
        $this->audit->log($userId, 'purchase_deleted', 'purchase', $id);
    }

    /** Copy of a purchase dated today (or a given date), as a new draft. */
    public function duplicate(string $userId, string $id, string $idempotencyKey, ?string $date = null): array
    {
        $p = $this->get($userId, $id);
        return $this->create($userId, [
            'idempotency_key' => $idempotencyKey, 'kind' => $p['kind'], 'status' => 'draft', 'origin' => 'manual',
            'total_cents' => $p['total_cents'], 'purchase_date' => $date ?? Clock::today(), 'installments' => $p['installments_total'],
            'recurring' => $p['recurring'], 'account_id' => $p['account_id'], 'category_id' => $p['category_id'],
            'description' => $p['description'], 'merchant' => $p['merchant'], 'notes' => $p['notes'], 'tags' => $p['tags'], 'allow_duplicate' => true,
        ])['purchase'];
    }

    /** @return array<string,mixed> */
    public function get(string $userId, string $id): array
    {
        $r = $this->db->one('SELECT * FROM purchases WHERE id = ? AND user_id = ?', [$id, $userId]);
        if ($r === null) {
            throw new HttpError(404, 'not_found', 'Lançamento não encontrado.');
        }
        $inst = $this->db->all('SELECT seq, amount_cents, month, status FROM installments WHERE purchase_id = ? AND user_id = ? ORDER BY seq', [$id, $userId]);
        return $this->shape($r) + ['schedule' => array_map(fn ($i) => ['seq' => (int) $i['seq'], 'amount_cents' => (int) $i['amount_cents'], 'month' => substr($i['month'], 0, 7), 'status' => $i['status']], $inst)];
    }

    /**
     * Rows that count in a month (one per installment), newest purchase first.
     * @param array<string,mixed> $filters @return list<array<string,mixed>>
     */
    public function listMonth(string $userId, string $monthStart, array $filters = []): array
    {
        $this->materializeRecurring($userId, $monthStart);
        $sql = 'SELECT p.*, i.seq, i.amount_cents, i.month, i.status AS inst_status FROM installments i
                JOIN purchases p ON p.id = i.purchase_id AND p.user_id = i.user_id
                WHERE i.user_id = ? AND i.month = ?';
        $params = [$userId, $monthStart];
        foreach (['account_id' => 'p.account_id', 'category_id' => 'p.category_id'] as $k => $col) {
            if (isset($filters[$k]) && Id::valid($filters[$k])) {
                $sql .= " AND $col = ?";
                $params[] = $filters[$k];
            }
        }
        if (isset($filters['kind']) && in_array($filters['kind'], self::KINDS, true)) {
            $sql .= ' AND p.kind = ?';
            $params[] = $filters['kind'];
        }
        if (isset($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $sql .= ' AND i.status = ?';
            $params[] = $filters['status'];
        }
        $sql .= ' ORDER BY p.purchase_date DESC, p.created_at DESC LIMIT 1000';
        return array_map(fn ($r) => $this->shape($r) + ['seq' => (int) $r['seq'], 'amount_cents' => (int) $r['amount_cents'], 'month' => substr($r['month'], 0, 7), 'installment_status' => $r['inst_status']], $this->db->all($sql, $params));
    }

    /** @return list<array<string,mixed>> */
    public function recent(string $userId, int $limit = 10): array
    {
        $rows = $this->db->all('SELECT * FROM purchases WHERE user_id = ? AND status <> \'cancelled\' ORDER BY created_at DESC LIMIT ' . max(1, min(50, $limit)), [$userId]);
        return array_map(fn ($r) => $this->shape($r), $rows);
    }

    /**
     * Monthly recurring purchases get one installment per month, created on demand up to the month being viewed
     * (never beyond next month). The unique (purchase_id, seq) key makes this safe to run any number of times.
     */
    public function materializeRecurring(string $userId, string $uptoMonthStart): void
    {
        $limit = Clock::now()->modify('first day of next month')->format('Y-m-d');
        $upto = min($uptoMonthStart, $limit);
        $rows = $this->db->all('SELECT id, total_cents, purchase_date, account_id, status FROM purchases WHERE user_id = ? AND recurring = \'monthly\' AND status NOT IN (\'cancelled\', \'draft\')', [$userId]);
        foreach ($rows as $p) {
            $account = $p['account_id'] !== null ? $this->accounts->get($userId, $p['account_id']) : null;
            $first = new \DateTimeImmutable(Ledger::firstMonth($p['purchase_date'], $account['kind'] ?? null, $account['closing_day'] ?? null, $account['due_day'] ?? null), Clock::tz());
            $max = (int) ($this->db->one('SELECT MAX(seq) AS m FROM installments WHERE purchase_id = ?', [$p['id']])['m'] ?? 0);
            $cancelledFuture = $this->db->one('SELECT 1 FROM installments WHERE purchase_id = ? AND status = \'cancelled\' LIMIT 1', [$p['id']]);
            if ($cancelledFuture !== null) {
                continue;
            }
            for ($seq = $max + 1; $seq <= 240; $seq++) {
                $m = $first->modify('+' . ($seq - 1) . ' month')->format('Y-m-d');
                if ($m > $upto) {
                    break;
                }
                $this->db->run(
                    'INSERT IGNORE INTO installments (id, user_id, purchase_id, seq, amount_cents, month, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [Id::new(), $userId, $p['id'], $seq, (int) $p['total_cents'], $m, $p['status'], Clock::sql(), Clock::sql()]
                );
            }
        }
    }

    /** @param array<string,mixed>|null $account */
    private function writeSchedule(string $userId, string $purchaseId, int $total, int $n, string $date, ?array $account, string $status): void
    {
        foreach (Ledger::schedule($total, $n, $date, $account['kind'] ?? null, $account['closing_day'] ?? null, $account['due_day'] ?? null) as $row) {
            $this->db->run(
                'INSERT INTO installments (id, user_id, purchase_id, seq, amount_cents, month, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [Id::new(), $userId, $purchaseId, $row['seq'], $row['amount_cents'], $row['month'], $status, Clock::sql(), Clock::sql()]
            );
        }
    }

    private function guardDuplicate(string $userId, int $total, string $date, ?string $merchantKey): void
    {
        $since = Clock::sql(Clock::now()->modify('-10 minutes'));
        $sql = 'SELECT id FROM purchases WHERE user_id = ? AND total_cents = ? AND purchase_date = ? AND status <> \'cancelled\' AND created_at >= ?';
        $params = [$userId, $total, $date, $since];
        if ($merchantKey !== null) {
            $sql .= ' AND merchant_key = ?';
            $params[] = $merchantKey;
        }
        $dup = $this->db->one($sql . ' LIMIT 1', $params);
        if ($dup !== null) {
            throw new HttpError(409, 'probable_duplicate', 'Parece que você já lançou isso agora há pouco. Lançar de novo mesmo assim?', ['existing_id' => $dup['id']]);
        }
    }

    /** @return array<string,mixed>|null */
    private function ownedAccount(string $userId, ?string $id): ?array
    {
        return $id === null ? null : $this->accounts->get($userId, $id);
    }

    private function ownedCategory(string $userId, ?string $id, string $kind): ?string
    {
        if ($id === null) {
            return null;
        }
        $c = $this->categories->get($userId, $id);
        if ($kind === 'income' && $c['group'] !== 'income') {
            throw new HttpError(422, 'category_kind_mismatch', 'Para uma entrada, escolha uma categoria de receita.');
        }
        if ($kind === 'expense' && $c['group'] === 'income') {
            throw new HttpError(422, 'category_kind_mismatch', 'Essa categoria é de receita, não de gasto.');
        }
        return $c['id'];
    }

    /** @return list<string> */
    private static function tags(mixed $tags): array
    {
        if ($tags === null) {
            return [];
        }
        if (!is_array($tags) || count($tags) > 10) {
            throw new HttpError(422, 'invalid_tags', 'Até 10 tags.');
        }
        $out = [];
        foreach ($tags as $t) {
            if (!is_string($t) || mb_strlen(trim($t)) === 0 || mb_strlen($t) > 30) {
                throw new HttpError(422, 'invalid_tags', 'Cada tag precisa ter de 1 a 30 caracteres.');
            }
            $out[] = mb_strtolower(trim($t));
        }
        return array_values(array_unique($out));
    }

    /** @param array<string,mixed> $r @return array<string,mixed> */
    private function shape(array $r): array
    {
        $tags = $this->crypto->decrypt($r['tags_enc']);
        return [
            'id' => $r['id'], 'kind' => $r['kind'], 'status' => $r['status'], 'origin' => $r['origin'],
            'total_cents' => (int) $r['total_cents'], 'currency' => $r['currency'], 'purchase_date' => $r['purchase_date'],
            'account_id' => $r['account_id'], 'category_id' => $r['category_id'],
            'installments_total' => (int) $r['installments_total'], 'recurring' => $r['recurring'],
            'description' => $this->crypto->decrypt($r['description_enc']), 'merchant' => $this->crypto->decrypt($r['merchant_enc']),
            'notes' => $this->crypto->decrypt($r['notes_enc']), 'tags' => $tags !== null ? (json_decode($tags, true) ?: []) : [],
            'created_at' => $r['created_at'], 'updated_at' => $r['updated_at'],
        ];
    }
}
