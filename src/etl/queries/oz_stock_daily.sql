-- Ozon FBO stock: day x SKU (available for sale, summed over clusters and seller accounts), plus Ozon's own average daily sales estimate (ads and idc are per SKU and repeat on every warehouse row - so MAX, not SUM)
SELECT __stock_dt AS d, sku, MAX(offer_id) AS offer_id, SUM(available_stock_count) AS stock, SUM(transit_stock_count) AS transit, MAX(ads) AS ads, MAX(idc) AS idc
FROM stg.oz_api__analytics__stocks_fbo
GROUP BY __stock_dt, sku
