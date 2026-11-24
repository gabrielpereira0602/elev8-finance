<?php
declare(strict_types=1);

namespace Elev8\Finance;

/** Categories: 16 spending defaults from the brief plus income, all editable per user. */
final class Categories
{
    public const GROUPS = ['need', 'want', 'save', 'income', 'transfer'];

    /** @var list<array{0:string,1:string}> name, group */
    public const DEFAULTS = [
        ['Moradia', 'need'], ['Contas e serviços', 'need'], ['Alimentação em casa', 'need'], ['Comida fora', 'want'],
        ['Transporte', 'need'], ['Saúde', 'need'], ['Educação', 'need'], ['Lazer', 'want'],
        ['Compras', 'want'], ['Assinaturas', 'want'], ['Trabalho/negócio', 'need'], ['Impostos e tarifas', 'need'],
        ['Investimentos', 'save'], ['Transferências', 'transfer'], ['Reembolsáveis', 'want'], ['Outros', 'want'],
        ['Salário', 'income'], ['Renda extra', 'income'],
    ];

    public function __construct(private Db $db, private Audit $audit, private Crypto $crypto)
    {
    }

    public function seed(string $userId): void
    {
        foreach (self::DEFAULTS as $i => [$name, $grp]) {
            $this->db->run(
                'INSERT INTO categories (id, user_id, name, grp, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [Id::new(), $userId, $name, $grp, $i, Clock::sql(), Clock::sql()]
            );
        }
    }

    /** @return list<array<string,mixed>> */
    public function list(string $userId, bool $withArchived = false): array
    {
        $rows = $this->db->all(
            'SELECT id, name, grp, archived, sort_order FROM categories WHERE user_id = ?' . ($withArchived ? '' : ' AND archived = 0') . ' ORDER BY sort_order, name',
            [$userId]
        );
        return array_map(fn ($r) => ['id' => $r['id'], 'name' => $r['name'], 'group' => $r['grp'], 'archived' => (bool) $r['archived'], 'sort_order' => (int) $r['sort_order']], $rows);
    }

    /** @return array<string,mixed> */
    public function get(string $userId, string $id): array
    {
        $r = $this->db->one('SELECT id, name, grp, archived, sort_order FROM categories WHERE id = ? AND user_id = ?', [$id, $userId]);
        if ($r === null) {
            throw new HttpError(404, 'not_found', 'Categoria não encontrada.');
        }
        return ['id' => $r['id'], 'name' => $r['name'], 'group' => $r['grp'], 'archived' => (bool) $r['archived'], 'sort_order' => (int) $r['sort_order']];
    }

    /** @param array<string,mixed> $in @return array<string,mixed> */
    public function create(string $userId, array $in): array
    {
        $name = Validate::str($in, 'name', 60, true);
        $grp = Validate::oneOf($in, 'group', self::GROUPS);
        $n = (int) ($this->db->one('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', [$userId])['n'] ?? 0);
        if ($n >= 80) {
            throw new HttpError(422, 'limit_reached', 'Limite de 80 categorias no beta.');
        }
        $id = Id::new();
        $this->db->run('INSERT INTO categories (id, user_id, name, grp, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [$id, $userId, $name, $grp, $n, Clock::sql(), Clock::sql()]);
        $this->audit->log($userId, 'category_created', 'category', $id);
        return $this->get($userId, $id);
    }

    /** Rename, regroup, archive or reorder. Archived categories keep their history. @param array<string,mixed> $in @return array<string,mixed> */
    public function update(string $userId, string $id, array $in): array
    {
        $cur = $this->get($userId, $id);
        $name = array_key_exists('name', $in) ? Validate::str($in, 'name', 60, true) : $cur['name'];
        $grp = array_key_exists('group', $in) ? Validate::oneOf($in, 'group', self::GROUPS) : $cur['group'];
        $archived = array_key_exists('archived', $in) ? (bool) $in['archived'] : $cur['archived'];
        $sort = Validate::int($in, 'sort_order', 0, 999, $cur['sort_order']);
        $this->db->run('UPDATE categories SET name = ?, grp = ?, archived = ?, sort_order = ?, updated_at = ? WHERE id = ? AND user_id = ?', [$name, $grp, $archived ? 1 : 0, $sort, Clock::sql(), $id, $userId]);
        $this->audit->log($userId, 'category_updated', 'category', $id);
        return $this->get($userId, $id);
    }

    /** Remember the category this user picked for a merchant. Only their own choices teach the suggestion. */
    public function learn(string $userId, ?string $merchant, string $categoryId): void
    {
        if ($merchant === null) {
            return;
        }
        $key = $this->crypto->keyed(self::normalize($merchant));
        $this->db->run(
            'INSERT INTO merchant_rules (user_id, merchant_key, category_id, hits, updated_at) VALUES (?, ?, ?, 1, ?)
             ON DUPLICATE KEY UPDATE hits = IF(category_id = VALUES(category_id), hits + 1, 1), category_id = VALUES(category_id), updated_at = VALUES(updated_at)',
            [$userId, $key, $categoryId, Clock::sql()]
        );
    }

    public function suggest(string $userId, string $merchant): ?string
    {
        $row = $this->db->one(
            'SELECT r.category_id FROM merchant_rules r JOIN categories c ON c.id = r.category_id AND c.user_id = r.user_id AND c.archived = 0 WHERE r.user_id = ? AND r.merchant_key = ?',
            [$userId, $this->crypto->keyed(self::normalize($merchant))]
        );
        return $row['category_id'] ?? null;
    }

    public static function normalize(string $merchant): string
    {
        $s = mb_strtolower(trim($merchant));
        $s = strtr($s, ['á' => 'a', 'à' => 'a', 'â' => 'a', 'ã' => 'a', 'é' => 'e', 'ê' => 'e', 'í' => 'i', 'ó' => 'o', 'ô' => 'o', 'õ' => 'o', 'ú' => 'u', 'ç' => 'c']);
        return preg_replace('/\s+/', ' ', $s) ?? $s;
    }
}
