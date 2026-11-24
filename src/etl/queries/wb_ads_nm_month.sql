-- WB ads by card for list 101: month x nm_id -> spend and ad-driven orders.
-- Same source as the cube's ads fact, but the cube now spreads ads over 1C products rather than nm_id
SELECT CONVERT(char(7), date, 120) AS ym, nm_id,
       SUM(sum) AS cost, SUM(sum_price) AS orders_rub
FROM stg.wb_api__fullstats
WHERE date >= '2025-01-01'
GROUP BY CONVERT(char(7), date, 120), nm_id
