<?php
declare(strict_types=1);

namespace Elev8\Finance;

use DateTimeImmutable;
use DateTimeZone;
use PDO;

/** Thrown for any request the API refuses; carries the HTTP status and a stable error code. */
final class HttpError extends \RuntimeException
{
    /** @param array<string,mixed> $details */
    public function __construct(public readonly int $status, public readonly string $errorCode, string $message = '', public readonly array $details = [])
    {
        parent::__construct($message !== '' ? $message : $errorCode);
    }
}

/** Random, non-sequential 26-character identifiers (Crockford base32, 130 bits). */
final class Id
{
    private const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

    public static function new(): string
    {
        $bytes = random_bytes(17);
        $out = '';
        $bits = 0;
        $value = 0;
        foreach (str_split($bytes) as $b) {
            $value = ($value << 8) | ord($b);
            $bits += 8;
            while ($bits >= 5 && strlen($out) < 26) {
                $bits -= 5;
                $out .= self::ALPHABET[($value >> $bits) & 31];
            }
            $value &= (1 << $bits) - 1;
        }
        return $out;
    }

    public static function valid(mixed $id): bool
    {
        return is_string($id) && preg_match('/^[0-9a-hjkmnp-tv-z]{26}$/', $id) === 1;
    }
}

/** Time source fixed to America/Sao_Paulo; tests can freeze it. */
final class Clock
{
    private static ?DateTimeImmutable $frozen = null;

    public static function tz(): DateTimeZone
    {
        return new DateTimeZone('America/Sao_Paulo');
    }

    public static function now(): DateTimeImmutable
    {
        return self::$frozen ?? new DateTimeImmutable('now', self::tz());
    }

    public static function freeze(?string $at): void
    {
        self::$frozen = $at === null ? null : new DateTimeImmutable($at, self::tz());
    }

    public static function sql(?DateTimeImmutable $t = null): string
    {
        return ($t ?? self::now())->format('Y-m-d H:i:s');
    }

    public static function today(): string
    {
        return self::now()->format('Y-m-d');
    }
}

/** Encryption at rest for free text (descriptions, merchants, notes) and keyed hashes for lookups. */
final class Crypto
{
    private string $key;
    private string $hmacKey;

    public function __construct(string $base64Key)
    {
        $raw = base64_decode($base64Key, true);
        if ($raw === false || strlen($raw) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES) {
            throw new \RuntimeException('Invalid encryption key: expected 32 bytes, base64.');
        }
        $this->key = $raw;
        $this->hmacKey = sodium_crypto_generichash('hmac', $raw, 32);
    }

    public function encrypt(?string $plain): ?string
    {
        if ($plain === null || $plain === '') {
            return null;
        }
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        return $nonce . sodium_crypto_secretbox($plain, $nonce, $this->key);
    }

    public function decrypt(?string $blob): ?string
    {
        if ($blob === null || $blob === '') {
            return null;
        }
        $nonce = substr($blob, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $box = substr($blob, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $plain = sodium_crypto_secretbox_open($box, $nonce, $this->key);
        return $plain === false ? null : $plain;
    }

    /** Stable keyed hash, used to recognise a merchant without storing its name. */
    public function keyed(string $value): string
    {
        return bin2hex(sodium_crypto_generichash($value, $this->hmacKey, 32));
    }
}

/** Thin PDO wrapper: prepared statements only. */
final class Db
{
    public function __construct(public readonly PDO $pdo)
    {
        $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
        $pdo->setAttribute(PDO::ATTR_EMULATE_PREPARES, false);
    }

    /** @param array<string,mixed> $config */
    public static function connect(array $config): self
    {
        $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=utf8mb4', $config['host'], $config['port'] ?? 3306, $config['name']);
        $pdo = new PDO($dsn, $config['user'], $config['pass']);
        $pdo->exec("SET time_zone = '-03:00'");
        return new self($pdo);
    }

    /** @param array<string|int,mixed> $params */
    public function run(string $sql, array $params = []): \PDOStatement
    {
        $st = $this->pdo->prepare($sql);
        $st->execute($params);
        return $st;
    }

    /** @param array<string|int,mixed> $params @return array<string,mixed>|null */
    public function one(string $sql, array $params = []): ?array
    {
        $row = $this->run($sql, $params)->fetch();
        return $row === false ? null : $row;
    }

    /** @param array<string|int,mixed> $params @return list<array<string,mixed>> */
    public function all(string $sql, array $params = []): array
    {
        return $this->run($sql, $params)->fetchAll();
    }

    /** @template T @param callable():T $fn @return T */
    public function tx(callable $fn): mixed
    {
        if ($this->pdo->inTransaction()) {
            return $fn();
        }
        $this->pdo->beginTransaction();
        try {
            $out = $fn();
            $this->pdo->commit();
            return $out;
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            throw $e;
        }
    }
}

/** Technical audit trail: action and record id only, never amounts or text. */
final class Audit
{
    public function __construct(private Db $db)
    {
    }

    public function log(?string $userId, string $action, ?string $entity = null, ?string $entityId = null): void
    {
        $this->db->run(
            'INSERT INTO audit_log (user_id, action, entity, entity_id, created_at) VALUES (?, ?, ?, ?, ?)',
            [$userId, $action, $entity, $entityId, Clock::sql()]
        );
    }
}
