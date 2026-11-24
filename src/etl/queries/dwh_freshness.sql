SELECT 'wb_stock' AS src, MAX(__stock_dt) AS dmax, MAX(__load_dts) AS loaded FROM stg.wb_api__analytics__stocks__daily
UNION ALL SELECT 'oz_stock', MAX(__stock_dt), MAX(__load_dts) FROM stg.oz_api__analytics__stocks_fbo
UNION ALL SELECT 'wb_search', MAX(__analytical_dt), MAX(__load_dts) FROM stg.wb_api__analytics__search_queries
UNION ALL SELECT 'wb_funnel', MAX(dt), MAX(__load_dts) FROM stg.wb_api__analytics__sales_funnel
UNION ALL SELECT 'oz_ads', MAX(__analytical_dt), MAX(__load_dts) FROM stg.oz_api__statistics__products
UNION ALL SELECT 'wb_ads', MAX(date), MAX(__load_dts) FROM stg.wb_api__fullstats
