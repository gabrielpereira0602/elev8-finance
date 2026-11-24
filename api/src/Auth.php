<?php
declare(strict_types=1);

namespace Elev8\Finance;

/**
 * Sessions: a random 256-bit token lives only in an HttpOnly cookie; the database keeps its SHA-256.
 * Each session also has a CSRF token the app must echo in the X-CSRF-Token header on every write.
 * Login is throttled per hashed IP and per hashed e-mail; repeated failures lock the account briefly.
 */
final class Auth
{
    public const COOKIE = 'e8f_session';
    public const SESSION_DAYS = 30;
    private const MAX_FAILS = 5;
    private const WINDOW_MIN = 15;
    private const LOCK_MIN = 15;

    public function __construct(private Db $db, private Audit $audit, private string $pepper)
    {
    }

    public static function hashPassword(string $password): string
    {
        return password_hash($password, PASSWORD_ARGON2ID);
    }

    public static function checkPasswordStrength(string $password): void
    {
        if (mb_strlen($password) < 10) {
            throw new HttpError(422, 'weak_password', 'A senha precisa ter pelo menos 10 caracteres.');
        }
    }

    private function key(string $kind, string $value): string
    {
        return hash_hmac('sha256', $kind . ':' . $value, $this->pepper);
    }

    private function throttled(string $keyHash): bool
    {
        $since = Clock::sql(Clock::now()->modify('-' . self::WINDOW_MIN . ' minutes'));
        $row = $this->db->one('SELECT COUNT(*) AS n FROM login_attempts WHERE key_hash = ? AND attempted_at >= ?', [$keyHash, $since]);
        return (int) ($row['n'] ?? 0) >= self::MAX_FAILS * 4; // IP-wide ceiling, looser than per-account lock
    }

    /** @return array{token:string, csrf:string, user_id:string, session_id:string} */
    public function login(string $email, string $password, string $ip, ?string $deviceLabel): array
    {
        $email = mb_strtolower(trim($email));
        $ipKey = $this->key('ip', $ip);
        if ($this->throttled($ipKey)) {
            throw new HttpError(429, 'too_many_attempts', 'Muitas tentativas. Tente de novo em alguns minutos.');
        }
        $this->db->run('INSERT INTO login_attempts (key_hash, attempted_at) VALUES (?, ?)', [$ipKey, Clock::sql()]);

        $user = $this->db->one('SELECT id, password_hash, failed_logins, locked_until FROM users WHERE email = ?', [$email]);
        $now = Clock::now();
        if ($user !== null && $user['locked_until'] !== null && new \DateTimeImmutable($user['locked_until'], Clock::tz()) > $now) {
            throw new HttpError(429, 'account_locked', 'Acesso bloqueado por alguns minutos após várias tentativas.');
        }
        // Verify against a dummy hash when the user does not exist, so timing does not reveal valid e-mails.
        $hash = $user['password_hash'] ?? self::hashPassword(bin2hex(random_bytes(8)));
        $ok = password_verify($password, $hash) && $user !== null;
        if (!$ok) {
            if ($user !== null) {
                $fails = (int) $user['failed_logins'] + 1;
                $lock = $fails >= self::MAX_FAILS ? Clock::sql($now->modify('+' . self::LOCK_MIN . ' minutes')) : null;
                $this->db->run('UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE id = ?', [$lock ? 0 : $fails, $lock, Clock::sql(), $user['id']]);
                $this->audit->log($user['id'], 'login_failed');
            }
            throw new HttpError(401, 'invalid_credentials', 'E-mail ou senha incorretos.');
        }
        if (password_needs_rehash($user['password_hash'], PASSWORD_ARGON2ID)) {
            $this->db->run('UPDATE users SET password_hash = ? WHERE id = ?', [self::hashPassword($password), $user['id']]);
        }
        $this->db->run('UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = ? WHERE id = ?', [Clock::sql(), $user['id']]);

        $token = bin2hex(random_bytes(32));
        $csrf = bin2hex(random_bytes(32));
        $sid = Id::new();
        $this->db->run(
            'INSERT INTO sessions (id, user_id, token_hash, csrf_token, device_label, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [$sid, $user['id'], hash('sha256', $token), $csrf, $deviceLabel !== null ? mb_substr($deviceLabel, 0, 120) : null, Clock::sql(), Clock::sql(), Clock::sql($now->modify('+' . self::SESSION_DAYS . ' days'))]
        );
        $this->audit->log($user['id'], 'login', 'session', $sid);
        return ['token' => $token, 'csrf' => $csrf, 'user_id' => $user['id'], 'session_id' => $sid];
    }

    /** @return array{user_id:string, session_id:string, csrf:string}|null */
    public function resolve(?string $token): ?array
    {
        if ($token === null || preg_match('/^[a-f0-9]{64}$/', $token) !== 1) {
            return null;
        }
        $row = $this->db->one(
            'SELECT id, user_id, csrf_token, expires_at, revoked_at, last_seen_at FROM sessions WHERE token_hash = ?',
            [hash('sha256', $token)]
        );
        if ($row === null || $row['revoked_at'] !== null || new \DateTimeImmutable($row['expires_at'], Clock::tz()) <= Clock::now()) {
            return null;
        }
        // Touch at most once an hour to keep writes low.
        if (new \DateTimeImmutable($row['last_seen_at'], Clock::tz()) < Clock::now()->modify('-1 hour')) {
            $this->db->run('UPDATE sessions SET last_seen_at = ? WHERE id = ?', [Clock::sql(), $row['id']]);
        }
        return ['user_id' => $row['user_id'], 'session_id' => $row['id'], 'csrf' => $row['csrf_token']];
    }

    public function logout(string $userId, string $sessionId): void
    {
        $this->db->run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ?', [Clock::sql(), $sessionId, $userId]);
        $this->audit->log($userId, 'logout', 'session', $sessionId);
    }

    public function logoutAll(string $userId): int
    {
        $n = $this->db->run('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [Clock::sql(), $userId])->rowCount();
        $this->audit->log($userId, 'logout_all');
        return $n;
    }

    /** @return list<array<string,mixed>> */
    public function sessions(string $userId, string $currentSessionId): array
    {
        $rows = $this->db->all(
            'SELECT id, device_label, created_at, last_seen_at FROM sessions WHERE user_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC',
            [$userId, Clock::sql()]
        );
        return array_map(fn ($r) => $r + ['current' => $r['id'] === $currentSessionId], $rows);
    }

    public function revokeSession(string $userId, string $sessionId): void
    {
        $n = $this->db->run('UPDATE sessions SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL', [Clock::sql(), $sessionId, $userId])->rowCount();
        if ($n === 0) {
            throw new HttpError(404, 'not_found', 'Sessão não encontrada.');
        }
        $this->audit->log($userId, 'session_revoked', 'session', $sessionId);
    }

    public function changePassword(string $userId, string $current, string $new): void
    {
        $user = $this->db->one('SELECT password_hash FROM users WHERE id = ?', [$userId]);
        if ($user === null || !password_verify($current, $user['password_hash'])) {
            throw new HttpError(403, 'invalid_credentials', 'Senha atual incorreta.');
        }
        self::checkPasswordStrength($new);
        $this->db->run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [self::hashPassword($new), Clock::sql(), $userId]);
        $this->audit->log($userId, 'password_changed');
    }
}
