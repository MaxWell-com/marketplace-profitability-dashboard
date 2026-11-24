-- WB stock in marketplace warehouses: day x card (summed over warehouses and sizes)
SELECT __stock_dt AS d, nm_id, MAX(vendor_code) AS vendor_code, SUM(stock_count) AS stock
FROM stg.wb_api__analytics__stocks__daily
GROUP BY __stock_dt, nm_id
