-- WB funnel by month: card -> views, add-to-cart, orders, buyouts
SELECT CONVERT(char(7), dt, 120) AS ym, nm_id,
       SUM(open_card_count) AS opens, SUM(add_to_cart_count) AS carts,
       SUM(orders_count) AS orders, SUM(orders_sum_rub) AS orders_rub,
       SUM(buyouts_count) AS buyouts, SUM(buyouts_sum_rub) AS buyouts_rub
FROM stg.wb_api__analytics__sales_funnel
GROUP BY CONVERT(char(7), dt, 120), nm_id
