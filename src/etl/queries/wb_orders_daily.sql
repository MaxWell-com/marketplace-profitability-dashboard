-- WB orders by day for the last 60 days (for stock turnover)
SELECT dt AS d, nm_id, SUM(orders_count) AS orders, SUM(orders_sum_rub) AS orders_rub
FROM stg.wb_api__analytics__sales_funnel
WHERE dt >= DATEADD(day, -60, CAST(GETDATE() AS date))
GROUP BY dt, nm_id
