<?php
declare(strict_types=1);

/**
 * Test runner without external dependencies (the build server cannot reach Packagist).
 * Needs a MySQL/MariaDB test database: FINANCE_TEST_DSN, FINANCE_TEST_USER, FINANCE_TEST_PASS.
 * Usage: php tests/run.php
 */

use Elev8\Finance\{App, Clock, Db, HttpError, Ledger, Validate};

require dirname(__DIR__) . '/vendor/autoload.php';

$pass = 0;
$fail = 0;
$current = '';

function ok(bool $cond, string $msg): void
{
    global $pass, $fail, $current;
    if ($cond) {
        $pass++;
    } else {
        $fail++;
        fwrite(STDERR, "  FALHOU [$current] $msg\n");
    }
}
function eq(mixed $a, mixed $b, string $msg): void
{
    ok($a === $b, $msg . ' (esperado ' . var_export($b, true) . ', veio ' . var_export($a, true) . ')');
}
function throws(callable $fn, string $code, string $msg): void
{
    try {
        $fn();
        ok(false, "$msg: não lançou $code");
    } catch (HttpError $e) {
        eq($e->errorCode, $code, $msg);
    }
}
function test(string $name, callable $fn): void
{
    global $current;
    $current = $name;
    try {
        $fn();
    } catch (\Throwable $e) {
        ok(false, 'exceção inesperada: ' . get_class($e) . ': ' . $e->getMessage() . ' @' . basename($e->getFile()) . ':' . $e->getLine());
    }
    Clock::freeze(null);
}

// ---------------------------------------------------------------- database
$pdo = new PDO(getenv('FINANCE_TEST_DSN') ?: 'mysql:host=localhost;dbname=finance_test;charset=utf8mb4', getenv('FINANCE_TEST_USER') ?: 'fin', getenv('FINANCE_TEST_PASS') ?: 'fin');
$db = new Db($pdo);
$pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
foreach ($db->all('SHOW TABLES') as $t) {
    $pdo->exec('DROP TABLE `' . array_values($t)[0] . '`');
}
$pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
foreach (array_filter(array_map('trim', explode(";\n", (string) file_get_contents(dirname(__DIR__) . '/migrations/001_init.sql')))) as $sql) {
    $sql = trim(preg_replace('/^(--[^\n]*\n)+/m', '', $sql . "\n") ?? '');
    if ($sql !== '') {
        $pdo->exec($sql);
    }
}
$config = ['encryption_key' => base64_encode(random_bytes(32)), 'pepper' => bin2hex(random_bytes(16)), 'app_origin' => 'https://finance.test', 'cookie_secure' => true];
$app = new App($db, $config);

function freshUser(App $app, string $tag): string
{
    return $app->users->create("$tag-" . bin2hex(random_bytes(4)) . '@teste.com', 'senha-forte-123', $tag);
}
function cat(App $app, string $uid, string $name): string
{
    foreach ($app->categories->list($uid) as $c) {
        if ($c['name'] === $name) {
            return $c['id'];
        }
    }
    throw new RuntimeException("categoria $name");
}
function ikey(): string
{
    return bin2hex(random_bytes(8));
}

// ---------------------------------------------------------------- pure rules
test('parcelas somam o total exato', function () {
    eq(Ledger::split(60000, 6), [10000, 10000, 10000, 10000, 10000, 10000], 'R$ 600 em 6x');
    eq(Ledger::split(10000, 3), [3334, 3333, 3333], 'R$ 100 em 3x');
    eq(array_sum(Ledger::split(48000, 7)), 48000, 'R$ 480 em 7x soma certo');
});

test('mês em que conta: débito e sem conta', function () {
    eq(Ledger::firstMonth('2026-12-20', 'debit', null, null), '2026-12-01', 'débito conta no mês da compra');
    eq(Ledger::firstMonth('2026-12-20', null, null, null), '2026-12-01', 'sem conta conta no mês da compra');
});

test('mês em que conta: cartão (fechamento e vencimento)', function () {
    eq(Ledger::firstMonth('2026-12-03', 'credit', 5, 12), '2026-12-01', 'antes do fechamento, vence no mesmo mês');
    eq(Ledger::firstMonth('2026-12-06', 'credit', 5, 12), '2027-01-01', 'depois do fechamento, vai para a próxima fatura');
    eq(Ledger::firstMonth('2026-12-10', 'credit', 28, 5), '2027-01-01', 'vencimento antes do fechamento cai no mês seguinte');
    eq(Ledger::firstMonth('2026-12-29', 'credit', 28, 5), '2027-02-01', 'depois do fechamento do dia 28');
    eq(Ledger::firstMonth('2027-02-28', 'credit', 31, 10), '2027-03-01', 'fechamento 31 em fevereiro usa o último dia');
});

test('cronograma de 6x atravessa o ano', function () {
    $s = Ledger::schedule(60000, 6, '2026-11-10', 'credit', 5, 12);
    eq(array_column($s, 'month'), ['2026-12-01', '2027-01-01', '2027-02-01', '2027-03-01', '2027-04-01', '2027-05-01'], 'meses seguidos');
});

test('validações de entrada', function () {
    Clock::freeze('2026-12-01 10:00');
    throws(fn () => Validate::date(['d' => '2026-02-30'], 'd'), 'invalid_date', 'data impossível');
    throws(fn () => Validate::date(['d' => '2062-01-01'], 'd'), 'date_too_far', 'data distante demais');
    throws(fn () => Validate::date(['d' => '2019-01-01'], 'd'), 'date_too_old', 'data antiga demais');
    throws(fn () => Validate::cents(['amount_cents' => 0]), 'amount_not_positive', 'valor zero');
    throws(fn () => Validate::cents(['amount_cents' => -500]), 'amount_not_positive', 'valor negativo');
    throws(fn () => Validate::cents(['amount_cents' => '10']), 'invalid_amount', 'valor como texto');
    throws(fn () => Validate::cents(['amount_cents' => 100_000_001]), 'amount_too_high', 'valor acima do limite');
    eq(Validate::date(['d' => '2026-12-05'], 'd'), '2026-12-05', 'data futura próxima é aceita');
});

test('fuso America/Sao_Paulo', function () {
    Clock::freeze('2026-11-30 22:30');
    eq(Clock::today(), '2026-11-30', '22h30 em São Paulo ainda é dia 30 (em UTC já seria 1º)');
});

// ---------------------------------------------------------------- purchases
test('compra parcelada gera compra-mãe e 6 parcelas', function () use ($app) {
    Clock::freeze('2026-11-10 12:00');
    $u = freshUser($app, 'a');
    $card = $app->accounts->create($u, ['name' => 'Cartão XP', 'kind' => 'credit', 'closing_day' => 5, 'due_day' => 12]);
    $p = $app->purchases->create($u, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 60000, 'purchase_date' => '2026-11-10', 'installments' => 6, 'account_id' => $card['id'], 'category_id' => cat($app, $u, 'Compras'), 'merchant' => 'Loja X', 'description' => 'Cadeira'])['purchase'];
    eq(count($p['schedule']), 6, '6 parcelas');
    eq(array_sum(array_column($p['schedule'], 'amount_cents')), 60000, 'parcelas somam R$ 600');
    eq($p['schedule'][0]['month'], '2026-12', 'primeira parcela na fatura de dezembro');
    eq($p['description'], 'Cadeira', 'descrição volta decifrada');
    $raw = $app->db->one('SELECT description_enc FROM purchases WHERE id = ?', [$p['id']]);
    ok(!str_contains((string) $raw['description_enc'], 'Cadeira'), 'descrição não fica em texto puro no banco');
});

test('retry e refresh nunca duplicam (idempotência)', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $u = freshUser($app, 'b');
    $k = ikey();
    $in = ['idempotency_key' => $k, 'status' => 'confirmed', 'total_cents' => 2850, 'purchase_date' => '2026-12-02', 'merchant' => 'Uber'];
    $a = $app->purchases->create($u, $in);
    $b = $app->purchases->create($u, $in);
    eq($a['purchase']['id'], $b['purchase']['id'], 'mesma chave devolve o mesmo lançamento');
    ok($b['replayed'] === true, 'segunda chamada marcada como repetição');
    eq((int) $app->db->one('SELECT COUNT(*) AS n FROM purchases WHERE user_id = ?', [$u])['n'], 1, 'só 1 compra no banco');
});

test('duplicidade provável é barrada e pode ser liberada', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $u = freshUser($app, 'c');
    $base = ['status' => 'confirmed', 'total_cents' => 8790, 'purchase_date' => '2026-12-02', 'merchant' => 'Mercado'];
    $app->purchases->create($u, $base + ['idempotency_key' => ikey()]);
    throws(fn () => $app->purchases->create($u, $base + ['idempotency_key' => ikey()]), 'probable_duplicate', 'mesmo valor, dia e lugar em 10 min');
    $r = $app->purchases->create($u, $base + ['idempotency_key' => ikey(), 'allow_duplicate' => true]);
    ok($r['replayed'] === false, 'com confirmação explícita, lança');
});

test('regras de parcelamento', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $u = freshUser($app, 'd');
    throws(fn () => $app->purchases->create($u, ['idempotency_key' => ikey(), 'total_cents' => 12990, 'purchase_date' => '2026-12-02', 'installments' => 3, 'recurring' => 'monthly']), 'installments_and_recurring', 'parcelado e recorrente ao mesmo tempo');
    throws(fn () => $app->purchases->create($u, ['idempotency_key' => ikey(), 'kind' => 'income', 'total_cents' => 500000, 'purchase_date' => '2026-12-02', 'installments' => 2]), 'installments_only_expense', 'receita parcelada');
    throws(fn () => $app->purchases->create($u, ['idempotency_key' => ikey(), 'total_cents' => 3, 'purchase_date' => '2026-12-02', 'installments' => 6]), 'installment_too_small', 'parcela menor que 1 centavo');
    throws(fn () => $app->purchases->create($u, ['idempotency_key' => ikey(), 'kind' => 'income', 'total_cents' => 1000, 'purchase_date' => '2026-12-02', 'category_id' => cat($app, $u, 'Moradia')]), 'category_kind_mismatch', 'receita com categoria de gasto');
});

test('editar uma parcela atualiza o total da compra', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $u = freshUser($app, 'e');
    $p = $app->purchases->create($u, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 48000, 'purchase_date' => '2026-12-02', 'installments' => 4])['purchase'];
    $p = $app->purchases->updateInstallment($u, $p['id'], 4, 13000);
    eq($p['total_cents'], 49000, 'total passa a R$ 490');
    eq($p['schedule'][3]['amount_cents'], 13000, 'parcela 4 com novo valor');
});

test('cancelar só as próximas parcelas mantém as passadas', function () use ($app) {
    Clock::freeze('2027-01-15 09:00');
    $u = freshUser($app, 'f');
    $p = $app->purchases->create($u, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 60000, 'purchase_date' => '2026-12-01', 'installments' => 6])['purchase'];
    $prev = $app->purchases->cancelPreview($u, $p['id']);
    eq($prev['future_count'], 4, 'prévia: 4 parcelas futuras (fev a mai)');
    $p = $app->purchases->cancel($u, $p['id'], 'future');
    eq(array_column($p['schedule'], 'status'), ['confirmed', 'confirmed', 'cancelled', 'cancelled', 'cancelled', 'cancelled'], 'dez e jan ficam; fev em diante cancela');
    $p = $app->purchases->cancel($u, $p['id'], 'all');
    eq($p['status'], 'cancelled', 'cancelar tudo cancela a compra');
});

test('recorrente mensal: gera um lançamento por mês, sem duplicar', function () use ($app) {
    Clock::freeze('2026-12-05 09:00');
    $u = freshUser($app, 'g');
    $p = $app->purchases->create($u, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 12990, 'purchase_date' => '2026-12-05', 'recurring' => 'monthly', 'merchant' => 'Academia'])['purchase'];
    $app->purchases->materializeRecurring($u, '2027-01-01');
    $app->purchases->materializeRecurring($u, '2027-01-01');
    $app->purchases->materializeRecurring($u, '2027-06-01'); // never beyond next month
    $months = array_column($app->purchases->get($u, $p['id'])['schedule'], 'month');
    eq($months, ['2026-12', '2027-01'], 'dezembro e janeiro, sem repetição e sem ir longe demais');
    $future = $app->metrics->future($u, 3);
    eq($future[2]['total_cents'], 12990, 'previsão de fevereiro inclui a academia projetada');
});

// ---------------------------------------------------------------- metrics never inflate
test('painel: transferência, pagamento de fatura, rascunho e cancelado não viram gasto', function () use ($app) {
    Clock::freeze('2026-12-18 10:00');
    $u = freshUser($app, 'h');
    $mk = fn (array $x) => $app->purchases->create($u, $x + ['idempotency_key' => ikey(), 'purchase_date' => '2026-12-10', 'allow_duplicate' => true]);
    $mk(['kind' => 'income', 'status' => 'confirmed', 'total_cents' => 500000, 'category_id' => cat($app, $u, 'Salário')]);
    $mk(['kind' => 'expense', 'status' => 'confirmed', 'total_cents' => 120000, 'category_id' => cat($app, $u, 'Moradia')]);
    $mk(['kind' => 'expense', 'status' => 'confirmed', 'total_cents' => 31000, 'category_id' => cat($app, $u, 'Comida fora')]);
    $mk(['kind' => 'refund', 'status' => 'confirmed', 'total_cents' => 1000]);
    $mk(['kind' => 'saving', 'status' => 'confirmed', 'total_cents' => 80000]);
    $mk(['kind' => 'transfer', 'status' => 'confirmed', 'total_cents' => 99999]);
    $mk(['kind' => 'invoice_payment', 'status' => 'confirmed', 'total_cents' => 77777]);
    $mk(['kind' => 'expense', 'status' => 'draft', 'total_cents' => 55555]);
    $c = $mk(['kind' => 'expense', 'status' => 'confirmed', 'total_cents' => 44444])['purchase'];
    $app->purchases->cancel($u, $c['id'], 'all');
    $s = $app->metrics->summary($u, '2026-12-01');
    eq($s['income_cents'], 500000, 'entrou');
    eq($s['spent_cents'], 150000, 'saiu = moradia + comida fora − reembolso');
    eq($s['saved_cents'], 80000, 'guardado separado');
    eq($s['balance_cents'], 270000, 'saldo do mês');
    eq($s['drafts'], 1, '1 rascunho esperando');
    eq($s['groups']['need'] + $s['groups']['want'], 151000, 'grupos 50/30/20 sem transferência nem fatura');
    eq($s['can_spend']['basis'], 'income', 'pode gastar hoje calculado pela renda');
    eq($s['can_spend']['days_left'], 14, '18 a 31 de dezembro');
    eq($s['can_spend']['left_cents'], 270000, 'sobra = renda − guardado − gasto');
    eq($s['can_spend']['per_day_cents'], intdiv(270000, 14), 'por dia');
});

// ---------------------------------------------------------------- isolation between users
test('um usuário nunca vê nem altera dados de outro', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $a = freshUser($app, 'iso-a');
    $b = freshUser($app, 'iso-b');
    $cardA = $app->accounts->create($a, ['name' => 'Nubank', 'kind' => 'credit', 'closing_day' => 3, 'due_day' => 10]);
    $pA = $app->purchases->create($a, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 9999, 'purchase_date' => '2026-12-02', 'account_id' => $cardA['id']])['purchase'];
    throws(fn () => $app->purchases->get($b, $pA['id']), 'not_found', 'ler');
    throws(fn () => $app->purchases->update($b, $pA['id'], ['total_cents' => 1]), 'not_found', 'editar');
    throws(fn () => $app->purchases->confirm($b, $pA['id']), 'not_found', 'confirmar');
    throws(fn () => $app->purchases->cancel($b, $pA['id'], 'all'), 'not_found', 'cancelar');
    throws(fn () => $app->purchases->delete($b, $pA['id']), 'not_found', 'apagar');
    throws(fn () => $app->purchases->updateInstallment($b, $pA['id'], 1, 5), 'not_found', 'editar parcela');
    throws(fn () => $app->purchases->duplicate($b, $pA['id'], ikey()), 'not_found', 'duplicar');
    throws(fn () => $app->accounts->update($b, $cardA['id'], ['name' => 'x']), 'not_found', 'editar cartão alheio');
    throws(fn () => $app->purchases->create($b, ['idempotency_key' => ikey(), 'total_cents' => 100, 'purchase_date' => '2026-12-02', 'account_id' => $cardA['id']]), 'not_found', 'usar cartão alheio');
    throws(fn () => $app->purchases->create($b, ['idempotency_key' => ikey(), 'total_cents' => 100, 'purchase_date' => '2026-12-02', 'category_id' => cat($app, $a, 'Lazer')]), 'not_found', 'usar categoria alheia');
    eq($app->purchases->listMonth($b, '2026-12-01'), [], 'lista do mês vazia');
    eq($app->metrics->summary($b, '2026-12-01')['spent_cents'], 0, 'painel zerado');
    eq($app->purchases->get($a, $pA['id'])['total_cents'], 9999, 'dado de A intacto');
});

// ---------------------------------------------------------------- HTTP layer
test('HTTP: login, cookie seguro, CSRF, origem e bloqueio', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $email = 'http-' . bin2hex(random_bytes(3)) . '@teste.com';
    $app->users->create($email, 'senha-forte-123');
    $h = ['content-type' => 'application/json', 'origin' => 'https://finance.test'];
    $r = $app->handle('GET', '/api/metrics/summary', [], '', [], [], '1.1.1.1');
    eq($r['status'], 401, 'sem login: 401');
    $r = $app->handle('POST', '/api/auth/login', [], json_encode(['email' => $email, 'password' => 'errada-1234']), $h, [], '1.1.1.2');
    eq($r['status'], 401, 'senha errada: 401');
    eq($r['body']['message'], 'E-mail ou senha incorretos.', 'mensagem não diz qual dos dois errou');
    $r = $app->handle('POST', '/api/auth/login', [], json_encode(['email' => $email, 'password' => 'senha-forte-123']), $h, [], '1.1.1.2');
    eq($r['status'], 200, 'login ok');
    $cookie = $r['cookies'][0];
    ok(str_contains($cookie, 'HttpOnly') && str_contains($cookie, 'Secure') && str_contains($cookie, 'SameSite=Strict'), 'cookie HttpOnly, Secure e SameSite=Strict');
    preg_match('/e8f_session=([a-f0-9]+)/', $cookie, $m);
    $c = ['e8f_session' => $m[1]];
    $csrf = $r['body']['csrf_token'];
    $body = json_encode(['name' => 'Cartão XP', 'kind' => 'credit', 'closing_day' => 5, 'due_day' => 12]);
    eq($app->handle('POST', '/api/accounts', [], $body, $h, $c, '1.1.1.2')['status'], 403, 'escrita sem CSRF: 403');
    eq($app->handle('POST', '/api/accounts', [], $body, ['content-type' => 'application/json', 'origin' => 'https://evil.test', 'x-csrf-token' => $csrf], $c, '1.1.1.2')['status'], 403, 'outra origem: 403');
    $ok = $app->handle('POST', '/api/accounts', [], $body, $h + ['x-csrf-token' => $csrf], $c, '1.1.1.2');
    eq($ok['status'], 201, 'com CSRF e origem certa: 201');
    eq($app->handle('GET', '/api/purchases/abc', [], '', $h, $c, '1.1.1.2')['status'], 404, 'id malformado: 404');
    eq($app->handle('POST', '/api/accounts', [], '{', $h + ['x-csrf-token' => $csrf], $c, '1.1.1.2')['status'], 400, 'JSON quebrado: 400');
    eq($app->handle('POST', '/api/accounts', [], str_repeat('a', App::MAX_BODY + 1), $h + ['x-csrf-token' => $csrf], $c, '1.1.1.2')['status'], 413, 'corpo grande demais: 413');
    $out = $app->handle('POST', '/api/auth/logout-all', [], '', $h + ['x-csrf-token' => $csrf], $c, '1.1.1.2');
    eq($out['status'], 200, 'sair de todos os aparelhos');
    eq($app->handle('GET', '/api/me', [], '', [], $c, '1.1.1.2')['status'], 401, 'sessão revogada não entra mais');
    for ($i = 0; $i < 5; $i++) {
        $app->handle('POST', '/api/auth/login', [], json_encode(['email' => $email, 'password' => 'errada-' . $i . 'xxxx']), $h, [], '1.1.1.9');
    }
    $r = $app->handle('POST', '/api/auth/login', [], json_encode(['email' => $email, 'password' => 'senha-forte-123']), $h, [], '1.1.1.9');
    eq($r['status'], 429, 'depois de 5 erros, bloqueia mesmo com a senha certa');
    Clock::freeze('2026-12-02 09:20');
    $r = $app->handle('POST', '/api/auth/login', [], json_encode(['email' => $email, 'password' => 'senha-forte-123']), $h, [], '1.1.1.8');
    eq($r['status'], 200, '15 minutos depois, libera');
});

test('exportar e excluir conta', function () use ($app) {
    Clock::freeze('2026-12-02 09:00');
    $u = freshUser($app, 'exp');
    $app->purchases->create($u, ['idempotency_key' => ikey(), 'status' => 'confirmed', 'total_cents' => 1000, 'purchase_date' => '2026-12-02', 'description' => '=HYPERLINK("x")']);
    $csv = $app->users->exportCsv($u, $app->purchases);
    ok(str_contains($csv, "'=HYPERLINK"), 'fórmula neutralizada no CSV');
    ok(str_contains($csv, '10,00'), 'valor em formato brasileiro');
    $email = $app->users->me($u)['email'];
    $app->users->delete($u, 'senha-forte-123');
    eq($app->db->one('SELECT COUNT(*) AS n FROM purchases WHERE user_id = ?', [$u])['n'], 0, 'lançamentos apagados');
    eq($app->db->one('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', [$u])['n'], 0, 'categorias apagadas');
    eq($app->db->one('SELECT COUNT(*) AS n FROM audit_log WHERE user_id = ?', [$u])['n'], 0, 'auditoria anonimizada');
    eq($app->db->one('SELECT id FROM users WHERE email = ?', [$email]), null, 'usuário apagado');
});

test('auditoria nunca guarda valores nem textos', function () use ($app) {
    $cols = array_column($app->db->all('SHOW COLUMNS FROM audit_log'), 'Field');
    eq($cols, ['id', 'user_id', 'action', 'entity', 'entity_id', 'created_at'], 'só ação e identificadores');
});

echo "\n" . ($fail === 0 ? "OK" : "FALHAS: $fail") . " · $pass verificações passaram\n";
exit($fail === 0 ? 0 : 1);
