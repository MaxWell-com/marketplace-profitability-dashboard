-- WB average search position by month (days without a position are excluded)
SELECT CONVERT(char(7), __analytical_dt, 120) AS ym, nm_id,
       AVG(CAST(average_position AS float)) AS pos, AVG(CAST(visibility AS float)) AS visibility,
       SUM(open_card) AS opens, SUM(orders) AS orders, COUNT(*) AS days
FROM stg.wb_api__analytics__search_queries
WHERE average_position > 0
GROUP BY CONVERT(char(7), __analytical_dt, 120), nm_id
