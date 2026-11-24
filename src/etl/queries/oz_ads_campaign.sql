-- Ozon ads by campaign and month (matches the cube where both exist; the cube has Ozon ads only for recent months)
SELECT CONVERT(char(7), __analytical_dt, 120) AS ym, CAST(id AS varchar(30)) AS camp, MAX(title) AS title,
       SUM(money_spent) AS cost, SUM(views) AS views, SUM(clicks) AS clicks, SUM(to_cart) AS cart,
       SUM(orders) AS orders, SUM(orders_money) AS orders_rub
FROM stg.oz_api__statistics__campaign__product
GROUP BY CONVERT(char(7), __analytical_dt, 120), id
HAVING SUM(money_spent) <> 0 OR SUM(orders_money) <> 0
