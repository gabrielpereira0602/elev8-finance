<?php
declare(strict_types=1);

namespace Elev8\Finance;

/**
 * HTTP entry point. Plain PHP, no framework.
 * Writes need: a valid session cookie, the session's CSRF token in X-CSRF-Token, and (when sent) an Origin equal to the app's.
 * Every resource lookup includes the session's user_id, so another user's id is always "not found".
 */
final class App
{
    public const MAX_BODY = 65536;

    public Auth $auth;
    public Users $users;
    public Accounts $accounts;
    public Categories $categories;
    public Purchases $purchases;
    public Budgets $budgets;
    public Metrics $metrics;
    public Audit $audit;

    /** @param array<string,mixed> $config */
    public function __construct(public Db $db, public array $config)
    {
        $crypto = new Crypto($config['encryption_key']);
        $this->audit = new Audit($db);
        $this->auth = new Auth($db, $this->audit, $config['pepper']);
        $this->categories = new Categories($db, $this->audit, $crypto);
        $this->accounts = new Accounts($db, $this->audit);
        $this->users = new Users($db, $this->audit, $this->categories, $crypto);
        $this->purchases = new Purchases($db, $this->audit, $crypto, $this->accounts, $this->categories);
        $this->budgets = new Budgets($db, $this->audit);
        $this->metrics = new Metrics($db, $this->purchases, $this->budgets);
    }

    /**
     * @param array<string,string> $headers lower-case names
     * @param array<string,string> $cookies
     * @param array<string,mixed> $query
     * @return array{status:int, body:mixed, headers:array<string,string>, cookies:list<string>}
     */
    public function handle(string $method, string $path, array $query, string $rawBody, array $headers, array $cookies, string $ip): array
    {
        $out = ['status' => 200, 'body' => null, 'headers' => [], 'cookies' => []];
        try {
            $path = '/' . trim(preg_replace('#^/api#', '', parse_url($path, PHP_URL_PATH) ?? '/') ?? '/', '/');
            $body = $this->parseBody($method, $rawBody, $headers);
            [$out['status'], $out['body']] = $this->route($method, $path, $query, $body, $headers, $cookies, $ip, $out);
        } catch (HttpError $e) {
            $out['status'] = $e->status;
            $out['body'] = ['error' => $e->errorCode, 'message' => $e->getMessage()] + ($e->details ? ['details' => $e->details] : []);
        } catch (\Throwable $e) {
            // Log the class and location only: no payloads, no values.
            error_log('[elev8-finance] ' . get_class($e) . ' at ' . basename($e->getFile()) . ':' . $e->getLine());
            $out['status'] = 500;
            $out['body'] = ['error' => 'server_error', 'message' => 'Algo deu errado do nosso lado. Tente de novo.'];
        }
        return $out;
    }

    /** @param array<string,string> $headers @return array<string,mixed> */
    private function parseBody(string $method, string $raw, array $headers): array
    {
        if (in_array($method, ['GET', 'HEAD', 'DELETE'], true) && $raw === '') {
            return [];
        }
        if (strlen($raw) > self::MAX_BODY) {
            throw new HttpError(413, 'payload_too_large', 'Requisição grande demais.');
        }
        if ($raw === '') {
            return [];
        }
        if (!str_starts_with($headers['content-type'] ?? '', 'application/json')) {
            throw new HttpError(415, 'unsupported_media_type', 'Envie JSON.');
        }
        $data = json_decode($raw, true);
        if (!is_array($data)) {
            throw new HttpError(400, 'invalid_json', 'JSON inválido.');
        }
        return $data;
    }

    /**
     * @param array<string,mixed> $q @param array<string,mixed> $b @param array<string,string> $h @param array<string,string> $c
     * @param array{status:int, body:mixed, headers:array<string,string>, cookies:list<string>} $out
     * @return array{0:int,1:mixed}
     */
    private function route(string $m, string $p, array $q, array $b, array $h, array $c, string $ip, array &$out): array
    {
        if ($m === 'GET' && $p === '/health') {
            $this->db->one('SELECT 1 AS ok');
            return [200, ['ok' => true, 'time' => Clock::now()->format(DATE_ATOM)]];
        }
        if ($m === 'POST' && $p === '/auth/login') {
            $this->checkOrigin($h);
            $email = Validate::str($b, 'email', 190, true);
            $password = $b['password'] ?? null;
            if (!is_string($password) || $password === '' || strlen($password) > 200) {
                throw new HttpError(422, 'missing_field', 'Informe a senha.');
            }
            $s = $this->auth->login($email, $password, $ip, Validate::str($b, 'device', 120));
            $out['cookies'][] = $this->cookie($s['token'], Auth::SESSION_DAYS * 86400);
            return [200, ['csrf_token' => $s['csrf'], 'user' => $this->users->me($s['user_id'])]];
        }

        $session = $this->auth->resolve($c[Auth::COOKIE] ?? null);
        if ($session === null) {
            throw new HttpError(401, 'unauthenticated', 'Faça login para continuar.');
        }
        $uid = $session['user_id'];
        if (!in_array($m, ['GET', 'HEAD'], true)) {
            $this->checkOrigin($h);
            if (!hash_equals($session['csrf'], $h['x-csrf-token'] ?? '')) {
                throw new HttpError(403, 'csrf', 'Sessão expirada nesta tela. Recarregue o app.');
            }
        }
        $seg = explode('/', trim($p, '/'));
        $id = $seg[1] ?? null;
        if ($id !== null && $id !== '' && !in_array($seg[0], ['budgets'], true) && !Id::valid($id) && !in_array($id, ['logout', 'logout-all', 'sessions', 'password', 'summary', 'future', 'trend', 'recent', 'suggest', 'delete'], true)) {
            throw new HttpError(404, 'not_found', 'Não encontrado.');
        }

        return match (true) {
            // session & account
            $m === 'GET' && $p === '/me' => [200, ['user' => $this->users->me($uid), 'csrf_token' => $session['csrf']]],
            $m === 'POST' && $p === '/auth/logout' => (function () use ($uid, $session, &$out) {
                $this->auth->logout($uid, $session['session_id']);
                $out['cookies'][] = $this->cookie('', -1);
                return [200, ['ok' => true]];
            })(),
            $m === 'POST' && $p === '/auth/logout-all' => (function () use ($uid, &$out) {
                $n = $this->auth->logoutAll($uid);
                $out['cookies'][] = $this->cookie('', -1);
                return [200, ['revoked' => $n]];
            })(),
            $m === 'GET' && $p === '/auth/sessions' => [200, ['sessions' => $this->auth->sessions($uid, $session['session_id'])]],
            $m === 'DELETE' && $seg[0] === 'sessions' && $id !== null => (function () use ($uid, $id) {
                $this->auth->revokeSession($uid, $id);
                return [200, ['ok' => true]];
            })(),
            $m === 'POST' && $p === '/auth/password' => (function () use ($uid, $b) {
                $this->auth->changePassword($uid, (string) ($b['current'] ?? ''), (string) ($b['new'] ?? ''));
                return [200, ['ok' => true]];
            })(),
            $m === 'GET' && $p === '/export' => [200, $this->users->export($uid, $this->accounts, $this->purchases)],
            $m === 'GET' && $p === '/export.csv' => (function () use ($uid, &$out) {
                $out['headers']['Content-Type'] = 'text/csv; charset=utf-8';
                $out['headers']['Content-Disposition'] = 'attachment; filename="elev8-finance-' . Clock::today() . '.csv"';
                return [200, $this->users->exportCsv($uid, $this->purchases)];
            })(),
            $m === 'POST' && $p === '/me/delete' => (function () use ($uid, $b, &$out) {
                $this->users->delete($uid, (string) ($b['password'] ?? ''));
                $out['cookies'][] = $this->cookie('', -1);
                return [200, ['deleted' => true]];
            })(),

            // accounts & categories
            $m === 'GET' && $p === '/accounts' => [200, ['accounts' => $this->accounts->list($uid, ($q['archived'] ?? '') === '1')]],
            $m === 'POST' && $p === '/accounts' => [201, ['account' => $this->accounts->create($uid, $b)]],
            $m === 'PATCH' && $seg[0] === 'accounts' && $id !== null => [200, ['account' => $this->accounts->update($uid, $id, $b)]],
            $m === 'GET' && $p === '/categories' => [200, ['categories' => $this->categories->list($uid, ($q['archived'] ?? '') === '1')]],
            $m === 'POST' && $p === '/categories' => [201, ['category' => $this->categories->create($uid, $b)]],
            $m === 'PATCH' && $seg[0] === 'categories' && $id !== null => [200, ['category' => $this->categories->update($uid, $id, $b)]],
            $m === 'GET' && $p === '/categories/suggest' => [200, ['category_id' => is_string($q['merchant'] ?? null) && $q['merchant'] !== '' ? $this->categories->suggest($uid, mb_substr($q['merchant'], 0, 80)) : null]],

            // purchases
            $m === 'POST' && $p === '/purchases' => (function () use ($uid, $b) {
                $r = $this->purchases->create($uid, $b);
                return [$r['replayed'] ? 200 : 201, ['purchase' => $r['purchase'], 'replayed' => $r['replayed']]];
            })(),
            $m === 'GET' && $p === '/purchases' => [200, ['month' => (string) ($q['month'] ?? ''), 'items' => $this->purchases->listMonth($uid, Ledger::monthStart((string) ($q['month'] ?? Clock::now()->format('Y-m'))), $q)]],
            $m === 'GET' && $p === '/purchases/recent' => [200, ['items' => $this->purchases->recent($uid, (int) ($q['limit'] ?? 10))]],
            $m === 'GET' && $seg[0] === 'purchases' && $id !== null && count($seg) === 2 => [200, ['purchase' => $this->purchases->get($uid, $id)]],
            $m === 'PATCH' && $seg[0] === 'purchases' && $id !== null && count($seg) === 2 => [200, ['purchase' => $this->purchases->update($uid, $id, $b)]],
            $m === 'DELETE' && $seg[0] === 'purchases' && $id !== null && count($seg) === 2 => (function () use ($uid, $id) {
                $this->purchases->delete($uid, $id);
                return [200, ['deleted' => true]];
            })(),
            $m === 'POST' && $seg[0] === 'purchases' && ($seg[2] ?? '') === 'confirm' => [200, ['purchase' => $this->purchases->confirm($uid, (string) $id)]],
            $m === 'GET' && $seg[0] === 'purchases' && ($seg[2] ?? '') === 'cancel-preview' => [200, $this->purchases->cancelPreview($uid, (string) $id)],
            $m === 'POST' && $seg[0] === 'purchases' && ($seg[2] ?? '') === 'cancel' => [200, ['purchase' => $this->purchases->cancel($uid, (string) $id, (string) ($b['scope'] ?? ''))]],
            $m === 'POST' && $seg[0] === 'purchases' && ($seg[2] ?? '') === 'duplicate' => [201, ['purchase' => $this->purchases->duplicate($uid, (string) $id, (string) ($b['idempotency_key'] ?? ''), isset($b['purchase_date']) ? Validate::date($b, 'purchase_date') : null)]],
            $m === 'PATCH' && $seg[0] === 'purchases' && ($seg[2] ?? '') === 'installments' && isset($seg[3]) && ctype_digit($seg[3]) => [200, ['purchase' => $this->purchases->updateInstallment($uid, (string) $id, (int) $seg[3], Validate::cents($b, 'amount_cents'))]],

            // budget & metrics
            $m === 'GET' && $seg[0] === 'budgets' && $id !== null => [200, ['month' => $id, 'amount_cents' => $this->budgets->forMonth($uid, Ledger::monthStart($id))]],
            $m === 'PUT' && $seg[0] === 'budgets' && $id !== null => (function () use ($uid, $id, $b) {
                $this->budgets->set($uid, Ledger::monthStart($id), Validate::int($b, 'amount_cents', 0, Validate::MAX_CENTS) ?? 0);
                return [200, ['month' => $id, 'amount_cents' => $this->budgets->forMonth($uid, Ledger::monthStart($id))]];
            })(),
            $m === 'GET' && $p === '/metrics/summary' => [200, $this->metrics->summary($uid, Ledger::monthStart((string) ($q['month'] ?? Clock::now()->format('Y-m'))))],
            $m === 'GET' && $p === '/metrics/future' => [200, ['months' => $this->metrics->future($uid, max(1, min(12, (int) ($q['months'] ?? 6))))]],
            $m === 'GET' && $p === '/metrics/trend' => [200, ['months' => $this->metrics->trend($uid, max(2, min(24, (int) ($q['months'] ?? 6))))]],

            default => throw new HttpError(404, 'not_found', 'Rota não encontrada.'),
        };
    }

    /** @param array<string,string> $h */
    private function checkOrigin(array $h): void
    {
        $origin = $h['origin'] ?? null;
        if ($origin !== null && $origin !== ($this->config['app_origin'] ?? '')) {
            throw new HttpError(403, 'bad_origin', 'Origem não permitida.');
        }
    }

    private function cookie(string $value, int $maxAge): string
    {
        $secure = ($this->config['cookie_secure'] ?? true) ? '; Secure' : '';
        return Auth::COOKIE . '=' . $value . '; Path=/api; Max-Age=' . $maxAge . '; HttpOnly; SameSite=Strict' . $secure;
    }
}
