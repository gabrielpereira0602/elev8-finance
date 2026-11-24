<?php
declare(strict_types=1);

namespace Elev8\Finance;

/** Input validation. Every message is user-facing Portuguese; codes are stable for the app. */
final class Validate
{
    public const MIN_CENTS = 1;              // R$ 0,01
    public const MAX_CENTS = 100_000_000;    // R$ 1.000.000,00 per purchase in the beta
    public const MAX_INSTALLMENTS = 48;
    public const MAX_FUTURE_DAYS = 400;      // allows booking next year's known bills, blocks typos like 2062
    public const MAX_PAST_YEARS = 5;

    /** @param array<string,mixed> $in */
    public static function str(array $in, string $key, int $max, bool $required = false): ?string
    {
        $v = $in[$key] ?? null;
        if ($v === null || $v === '') {
            if ($required) {
                throw new HttpError(422, 'missing_field', "Campo obrigatório: $key", ['field' => $key]);
            }
            return null;
        }
        if (!is_string($v)) {
            throw new HttpError(422, 'invalid_field', "Campo inválido: $key", ['field' => $key]);
        }
        $v = trim(preg_replace('/[\x00-\x1F\x7F]/u', ' ', $v) ?? '');
        if (mb_strlen($v) > $max) {
            throw new HttpError(422, 'too_long', "Texto longo demais em $key (máximo $max).", ['field' => $key]);
        }
        return $v === '' ? null : $v;
    }

    /** @param array<string,mixed> $in */
    public static function cents(array $in, string $key = 'amount_cents'): int
    {
        $v = $in[$key] ?? null;
        if (!is_int($v)) {
            throw new HttpError(422, 'invalid_amount', 'Valor inválido.', ['field' => $key]);
        }
        if ($v < self::MIN_CENTS) {
            throw new HttpError(422, 'amount_not_positive', 'O valor precisa ser maior que zero.', ['field' => $key]);
        }
        if ($v > self::MAX_CENTS) {
            throw new HttpError(422, 'amount_too_high', 'Valor acima do limite do beta (R$ 1.000.000,00).', ['field' => $key]);
        }
        return $v;
    }

    /** @param array<string,mixed> $in */
    public static function date(array $in, string $key): string
    {
        $v = $in[$key] ?? null;
        if (!is_string($v) || preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $v, $m) !== 1 || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
            throw new HttpError(422, 'invalid_date', 'Data inválida.', ['field' => $key]);
        }
        $d = new \DateTimeImmutable($v, Clock::tz());
        $today = new \DateTimeImmutable(Clock::today(), Clock::tz());
        if ($d > $today->modify('+' . self::MAX_FUTURE_DAYS . ' days')) {
            throw new HttpError(422, 'date_too_far', 'Data muito no futuro. Confira o ano.', ['field' => $key]);
        }
        if ($d < $today->modify('-' . self::MAX_PAST_YEARS . ' years')) {
            throw new HttpError(422, 'date_too_old', 'Data muito antiga. Confira o ano.', ['field' => $key]);
        }
        return $v;
    }

    /** @param array<string,mixed> $in @param list<string> $allowed */
    public static function oneOf(array $in, string $key, array $allowed, ?string $default = null): string
    {
        $v = $in[$key] ?? $default;
        if (!is_string($v) || !in_array($v, $allowed, true)) {
            throw new HttpError(422, 'invalid_option', "Opção inválida em $key.", ['field' => $key, 'allowed' => $allowed]);
        }
        return $v;
    }

    /** @param array<string,mixed> $in */
    public static function int(array $in, string $key, int $min, int $max, ?int $default = null): ?int
    {
        $v = $in[$key] ?? $default;
        if ($v === null) {
            return null;
        }
        if (!is_int($v) || $v < $min || $v > $max) {
            throw new HttpError(422, 'invalid_number', "Número fora do intervalo em $key ($min a $max).", ['field' => $key]);
        }
        return $v;
    }

    /** @param array<string,mixed> $in */
    public static function id(array $in, string $key, bool $required = false): ?string
    {
        $v = $in[$key] ?? null;
        if ($v === null) {
            if ($required) {
                throw new HttpError(422, 'missing_field', "Campo obrigatório: $key", ['field' => $key]);
            }
            return null;
        }
        if (!Id::valid($v)) {
            throw new HttpError(422, 'invalid_id', "Identificador inválido em $key.", ['field' => $key]);
        }
        return $v;
    }
}
