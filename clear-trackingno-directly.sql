-- 直接清除这 3 个 RFQ Item 的 trackingNo
-- 不使用事务，直接执行

UPDATE rfq_items
SET trackingNo = NULL,
    carrier = NULL,
    shipmentId = NULL,
    updatedAt = NOW()
WHERE id IN (
    'cmimue03d001gkqi6fvbx7kc1',
    'cmimue03d001hkqi6mfqsv0qv',
    'cmimue03d001ikqi6yqh3e06n'
)
AND trackingNo IS NOT NULL;

-- 验证结果
SELECT 
    id as rfq_item_id,
    productName,
    trackingNo,
    shipmentId,
    source,
    updatedAt
FROM rfq_items
WHERE id IN (
    'cmimue03d001gkqi6fvbx7kc1',
    'cmimue03d001hkqi6mfqsv0qv',
    'cmimue03d001ikqi6yqh3e06n'
);

