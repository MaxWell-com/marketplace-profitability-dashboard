-- WB ad campaign names (for the performer and the label)
SELECT id AS advert_id, MAX(settings__name) AS name, MAX(status) AS status
FROM stg.wb_api__adverts
GROUP BY id
