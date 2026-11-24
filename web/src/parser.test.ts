import { describe, expect, it } from 'vitest';
import { parse, toCents, wordsToDigits, type AccountRef, type CategoryRef } from './parser';

const accounts: AccountRef[] = [
  { id: 'xp', name: 'Cartão XP', kind: 'credit' },
  { id: 'nu', name: 'Nubank', kind: 'credit' },
  { id: 'pix', name: 'Conta Inter', kind: 'checking' },
];
const names: Array<[string, CategoryRef['group']]> = [
  ['Moradia', 'need'], ['Contas e serviços', 'need'], ['Alimentação em casa', 'need'], ['Comida fora', 'want'], ['Transporte', 'need'],
  ['Saúde', 'need'], ['Educação', 'need'], ['Lazer', 'want'], ['Compras', 'want'], ['Assinaturas', 'want'], ['Outros', 'want'],
  ['Salário', 'income'], ['Renda extra', 'income'],
];
const categories: CategoryRef[] = names.map(([name, group]) => ({ id: name, name, group }));
const today = new Date(2026, 11, 18); // sexta, 18/12/2026
const p = (s: string) => parse(s, accounts, categories, today);

describe('valores', () => {
  it('formatos brasileiros', () => {
    expect(toCents('28,50')).toBe(2850);
    expect(toCents('1.200,50')).toBe(120050);
    expect(toCents('480')).toBe(48000);
    expect(toCents('r$87,90')).toBe(8790);
    expect(toCents('12/12')).toBeNull();
  });
  it('números falados', () => {
    expect(wordsToDigits('farmacia quarenta e oito reais')).toBe('farmacia 48');
    expect(wordsToDigits('mercado cento e vinte reais e cinquenta')).toBe('mercado 120,50');
    expect(wordsToDigits('aluguel mil e duzentos')).toBe('aluguel 1200');
  });
});

describe('exemplos do briefing', () => {
  it('Uber 28,50 hoje transporte', () => {
    const d = p('Uber 28,50 hoje transporte');
    expect(d.amount_cents).toBe(2850);
    expect(d.purchase_date).toBe('2026-12-18');
    expect(d.category_id).toBe('Transporte');
    expect(d.merchant).toBe('Uber');
    expect(d.missing).toEqual([]);
  });
  it('Cadeira 480 em 4x cartão XP casa', () => {
    const d = p('Cadeira 480 em 4x cartão XP casa');
    expect(d.amount_cents).toBe(48000);
    expect(d.installments).toBe(4);
    expect(d.account_id).toBe('xp');
    expect(d.description).toBe('Cadeira');
    expect(d.tags).toEqual(['casa']);
  });
  it('Mercado 87,90 ontem alimentação em casa', () => {
    const d = p('Mercado 87,90 ontem alimentação em casa');
    expect(d.amount_cents).toBe(8790);
    expect(d.purchase_date).toBe('2026-12-17');
    expect(d.category_id).toBe('Alimentação em casa');
  });
  it('Academia 129,90 recorrente todo mês', () => {
    const d = p('Academia 129,90 recorrente todo mês');
    expect(d.amount_cents).toBe(12990);
    expect(d.recurring).toBe('monthly');
    expect(d.category_id).toBe('Saúde');
  });
});

describe('entradas, guardado e datas', () => {
  it('Recebi 4200 salário', () => {
    const d = p('Recebi 4200 salário');
    expect(d.kind).toBe('income');
    expect(d.amount_cents).toBe(420000);
    expect(d.category_id).toBe('Salário');
    expect(d.missing).toEqual([]);
  });
  it('mantém acentos e maiúsculas de quem escreveu', () => {
    expect(p('Farmácia São João 48').description).toBe('Farmácia São João');
  });
  it('Guardei 500', () => {
    const d = p('Guardei 500');
    expect(d.kind).toBe('saving');
    expect(d.missing).toEqual([]);
  });
  it('sexta, dia 5 e 05/12', () => {
    expect(p('Bar 60 na quinta').purchase_date).toBe('2026-12-17');
    expect(p('Bar 60 sexta').purchase_date).toBe('2026-12-18');
    expect(p('Luz 210 dia 5').purchase_date).toBe('2026-12-05');
    expect(p('Luz 210 dia 25').purchase_date).toBe('2026-11-25');
    expect(p('Livro 59,90 05/12').purchase_date).toBe('2026-12-05');
  });
  it('pix usa a única conta corrente', () => {
    expect(p('Padaria 12 no pix').account_id).toBe('pix');
  });
});

describe('nunca chuta quando há ambiguidade', () => {
  it('dois valores: pergunta qual', () => {
    const d = p('Farmácia 48 ou 84 cartão');
    expect(d.amount_cents).toBeNull();
    expect(d.missing[0]).toEqual({ field: 'amount_choice', options: [4800, 8400] });
  });
  it('sem valor: pergunta o valor', () => {
    expect(p('Mercado ontem').missing[0]).toEqual({ field: 'amount' });
  });
  it('parcelado sem cartão, com dois cartões: pergunta o cartão', () => {
    const d = p('Tênis 600 em 3x');
    expect(d.missing.some((m) => m.field === 'account')).toBe(true);
  });
  it('sem categoria reconhecida: pergunta a categoria', () => {
    expect(p('Coisa 30').missing.some((m) => m.field === 'category')).toBe(true);
  });
});
