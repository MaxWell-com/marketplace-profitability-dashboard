// A single gross-profit cascade ВП1-ВП4 (GP1-GP4) for all E-comm channels, built from the columns of
// the yearly profitability files.
//
// The logic comes from the "other clients" block of the previous Power BI report (the "costs from the file"
// variant, which the finance department confirmed as correct) and is applied identically to OZON, WB and
// other clients. No hard-coded rates: every line is a sum of file columns. Columns missing in a given year
// count as zero (e.g. acquiring and packaging columns appeared only in later files).
// A line is stored as a positive cost; level = previous level - its lines.

/** [id, label, file columns] */
export const LINES = [
  ['rev', 'Выручка', ['Выручка']],
  ['qty', 'Количество, шт', ['Количество']],
  ['cogs', 'Себестоимость', ['Себестоимость товаров']],
  ['vyp', 'Расходы на выпуск', ['Трудозатраты', 'ОПР Факт  без  тарифа', 'ОПР нераспределенный', 'ОПР по списаниям']],
  ['comm', 'Комиссия и ретро-бонус', ['Комиссионное вознаграждение', 'Ретро-бонус']],
  ['acq', 'Эквайринг', ['Эквайринг']],
  ['logi', 'Логистика (лог. премия)', ['Логистическая премия']],
  ['stor', 'Хранение', ['Расходы на хранение']],
  ['pack', 'Упаковка', ['Упаковка']],
  ['fines', 'Штрафы', ['Штрафы']],
  ['roy', 'Роялти', ['Роялти 2022']],
  ['mpother', 'Прочие расходы маркетплейса', ['Расходы по маркетплейсам']],
  ['trade', 'Трейд-маркетинг', ['Трейд-маркетинг']],
  ['listing', 'Листинг', ['Листинг']],
  ['transport', 'Наемный транспорт и поездки', ['Транспорт, наемный по номенклатуре', 'Стоимость поездки на sku']],
  ['dz', '% на ДЗ', ['% на ДЗ']],
  ['stgp', '% на сток ГП (2 мес)', ['% на сток  ГП (2 мес)']],
  ['dept', 'Расходы на отдел продаж', ['Расходы на отдел', 'Ритейл-Трейд', 'Маркетинг общий по клиенту', 'Списание ТМЦ-продажи']],
];

/** File lines outside the cascade: not used in the calculation; listed so these columns are not flagged as new. */
export const OUTSIDE = [
  ['x_mkt', 'Маркетинг общий', ['Маркетинг общий']],
  ['x_mktdept', 'Расходы на маркетинговый отдел', ['Расходы на маркетинговый отдел']],
  ['x_tech', 'Тех сервис и техсервис', ['Тех сервис', 'Расходы на отдел техсервиса', 'Затраты Региональных технологов', 'ВТП Техсервис']],
  ['x_vtp', 'ВТП', ['ВТП']],
  ['x_lic', 'Лицензии', ['Лицензии']],
  ['x_wo', 'Списание ТМЦ-маркетинг', ['Списание ТМЦ-маркетинг']],
  ['x_ins', 'Страхование', ['Страхование']],
  ['x_merch', 'Мерчендайзинг', ['Сумма мерчендайзинга по номенклатуре']],
  ['x_ads1', 'Реклама 1руб', ['Реклама 1руб']],
];

/** Planned overhead must not be added to actual overhead: excluded from the cascade and not shown. */
export const IGNORED = ['ОПР 2024', 'Плановый ОПР 2025'];

/** Levels: [id, label, lines subtracted from the previous level] */
export const LEVELS = [
  ['vp1', 'ВП1', ['cogs']],
  ['vp2', 'ВП2', ['vyp']],
  ['vp31', 'ВП3.1', ['comm', 'acq', 'logi']],
  ['vp32', 'ВП3.2', ['stor', 'pack', 'fines', 'mpother']],
  ['vp3', 'ВП3', ['roy', 'trade', 'listing', 'transport', 'dz', 'stgp']],
  ['vp4', 'ВП4', ['dept']],
];

export const MEASURES = LINES.map((l) => l[0]);

export function channel(client) {
  if (client === 'Интернет Решения ООО') return 'OZON';
  if (client === 'РВБ (ВАЙЛДБЕРРИЗ ООО)') return 'WB';
  return 'OTHER';
}

/** d: line totals (costs as positive numbers) -> adds the gross-profit levels. */
export function addLevels(d) {
  let cur = d.rev || 0;
  for (const [id, , items] of LEVELS) {
    cur -= items.reduce((s, i) => s + (d[i] || 0), 0);
    d[id] = cur;
  }
  return d;
}

export const zeroMeasures = () => Object.fromEntries(MEASURES.map((m) => [m, 0]));
export function sumMeasures(rows) {
  const o = zeroMeasures();
  for (const r of rows) for (const m of MEASURES) o[m] += r[m] || 0;
  return o;
}
