<?php
declare(strict_types=1);

namespace Elev8\Finance;

/** Account lifecycle: creation by invite (CLI only in the beta), export and full deletion. */
final class Users
{
    public function __construct(private Db $db, private Audit $audit, private Categories $categories, private Crypto $crypto)
    {
    }

    public function create(string $email, string $password, ?string $name = null): string
    {
        $email = mb_strtolower(trim($email));
        if (filter_var($email, FILTER_VALIDATE_EMAIL) === false) {
            throw new HttpError(422, 'invalid_email', 'E-mail inválido.');
        }
        Auth::checkPasswordStrength($password);
        if ($this->db->one('SELECT id FROM users WHERE email = ?', [$email]) !== null) {
            throw new HttpError(409, 'email_taken', 'Já existe uma conta com esse e-mail.');
        }
        $id = Id::new();
        $this->db->tx(function () use ($id, $email, $password, $name) {
            $this->db->run('INSERT INTO users (id, email, password_hash, display_name, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [$id, $email, Auth::hashPassword($password), $name, Clock::sql(), Clock::sql()]);
            $this->categories->seed($id);
        });
        $this->audit->log($id, 'user_created', 'user', $id);
        return $id;
    }

    /** @return array<string,mixed> */
    public function me(string $userId): array
    {
        $u = $this->db->one('SELECT id, email, display_name, created_at FROM users WHERE id = ?', [$userId]);
        if ($u === null) {
            throw new HttpError(401, 'unauthenticated', 'Faça login novamente.');
        }
        return $u;
    }

    /** Everything this person stored, readable, for the "export my data" right. @return array<string,mixed> */
    public function export(string $userId, Accounts $accounts, Purchases $purchases): array
    {
        $ids = $this->db->all('SELECT id FROM purchases WHERE user_id = ? ORDER BY purchase_date, created_at', [$userId]);
        $budgets = $this->db->all('SELECT month, amount_cents FROM budgets WHERE user_id = ? ORDER BY month', [$userId]);
        $this->audit->log($userId, 'data_exported');
        return [
            'exported_at' => Clock::now()->format(DATE_ATOM),
            'user' => $this->me($userId),
            'accounts' => $accounts->list($userId, true),
            'categories' => $this->categories->list($userId, true),
            'budgets' => array_map(fn ($b) => ['month' => substr($b['month'], 0, 7), 'amount_cents' => (int) $b['amount_cents']], $budgets),
            'purchases' => array_map(fn ($r) => $purchases->get($userId, $r['id']), $ids),
        ];
    }

    /** CSV of every installment row, one line per month it counts in. */
    public function exportCsv(string $userId, Purchases $purchases): string
    {
        $data = $this->export($userId, new Accounts($this->db, $this->audit), $purchases);
        $cats = array_column($data['categories'], 'name', 'id');
        $accs = array_column($data['accounts'], 'name', 'id');
        $f = fopen('php://temp', 'r+');
        fputcsv($f, ['data_compra', 'mes', 'tipo', 'status', 'descricao', 'estabelecimento', 'categoria', 'cartao_conta', 'parcela', 'total_parcelas', 'valor', 'valor_total_compra', 'tags'], ';');
        foreach ($data['purchases'] as $p) {
            foreach ($p['schedule'] as $s) {
                fputcsv($f, [
                    $p['purchase_date'], $s['month'], $p['kind'], $s['status'], self::safe($p['description']), self::safe($p['merchant']),
                    $cats[$p['category_id']] ?? '', $accs[$p['account_id']] ?? '', $s['seq'], $p['installments_total'],
                    number_format($s['amount_cents'] / 100, 2, ',', ''), number_format($p['total_cents'] / 100, 2, ',', ''), implode(' ', $p['tags']),
                ], ';');
            }
        }
        rewind($f);
        return "\xEF\xBB\xBF" . stream_get_contents($f); // BOM so Excel opens accents correctly
    }

    /** Neutralise spreadsheet formulas in user text (CSV injection). */
    private static function safe(?string $v): string
    {
        $v ??= '';
        return $v !== '' && in_array($v[0], ['=', '+', '-', '@', "\t", "\r"], true) ? "'" . $v : $v;
    }

    /** Deletes the account and every row that belongs to it. The audit trail keeps only an anonymous "account deleted" line. */
    public function delete(string $userId, string $password): void
    {
        $u = $this->db->one('SELECT password_hash FROM users WHERE id = ?', [$userId]);
        if ($u === null || !password_verify($password, $u['password_hash'])) {
            throw new HttpError(403, 'invalid_credentials', 'Senha incorreta.');
        }
        $this->db->tx(function () use ($userId) {
            $this->db->run('DELETE FROM users WHERE id = ?', [$userId]); // cascades to every table with user data
            $this->db->run('UPDATE audit_log SET user_id = NULL, entity_id = NULL WHERE user_id = ?', [$userId]);
        });
        $this->audit->log(null, 'user_deleted');
    }
}
