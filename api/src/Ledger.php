<?php
declare(strict_types=1);

namespace Elev8\Finance;

use DateTimeImmutable;

/**
 * Pure money and calendar rules. No database here, so every rule is unit-tested.
 *
 * Which month an amount counts in:
 *  - credit card: the month the invoice is DUE (when the money actually leaves);
 *  - any other account (debit, checking, cash) or no account: the purchase month.
 * Installment k (0-based) counts k months after the first one.
 */
final class Ledger
{
    /** Split total cents into n parts that add up exactly; the first parts absorb the remainder. @return list<int> */
    public static function split(int $totalCents, int $n): array
    {
        if ($n < 1) {
            throw new \InvalidArgumentException('installments must be >= 1');
        }
        $base = intdiv($totalCents, $n);
        $rest = $totalCents - $base * $n;
        $parts = [];
        for ($i = 0; $i < $n; $i++) {
            $parts[] = $base + ($i < $rest ? 1 : 0);
        }
        return $parts;
    }

    /**
     * First month (Y-m-01) an amount counts in.
     * Card rule: purchases made AFTER the closing day go to the next invoice.
     * The invoice that closes in month M is due in M if due_day > closing_day, else in M+1.
     */
    public static function firstMonth(string $purchaseDate, ?string $accountKind, ?int $closingDay, ?int $dueDay): string
    {
        $d = new DateTimeImmutable($purchaseDate, Clock::tz());
        $month = $d->modify('first day of this month');
        if ($accountKind !== 'credit' || $closingDay === null || $dueDay === null) {
            return $month->format('Y-m-d');
        }
        $closing = min($closingDay, (int) $month->format('t'));
        $closesIn = ((int) $d->format('j')) > $closing ? $month->modify('+1 month') : $month;
        $dueIn = $dueDay > $closingDay ? $closesIn : $closesIn->modify('+1 month');
        return $dueIn->format('Y-m-d');
    }

    /** @return list<array{seq:int, amount_cents:int, month:string}> */
    public static function schedule(int $totalCents, int $n, string $purchaseDate, ?string $accountKind, ?int $closingDay, ?int $dueDay): array
    {
        $first = new DateTimeImmutable(self::firstMonth($purchaseDate, $accountKind, $closingDay, $dueDay), Clock::tz());
        $out = [];
        foreach (self::split($totalCents, $n) as $i => $amount) {
            $out[] = ['seq' => $i + 1, 'amount_cents' => $amount, 'month' => $first->modify("+$i month")->format('Y-m-d')];
        }
        return $out;
    }

    public static function monthStart(string $ym): string
    {
        if (preg_match('/^\d{4}-(0[1-9]|1[0-2])$/', $ym) !== 1) {
            throw new HttpError(422, 'invalid_month', 'Mês inválido. Use AAAA-MM.');
        }
        return $ym . '-01';
    }

    /** Kinds that are spending. Transfers, invoice payments and investments never inflate "Saiu". */
    public const SPENDING = ['expense'];
    /** Statuses that count in totals. Drafts and cancelled never count. */
    public const COUNTED = ['confirmed', 'pending', 'reimbursable', 'reimbursed'];
}
