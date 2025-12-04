-- 全面检查中标逻辑问题
-- 检查所有询价单的中标逻辑是否正确

USE caigou;

-- ============================================
-- 1. 检查同一商品是否有多个 ACTIVE Award（不同供应商）
-- ============================================
SELECT 
    '问题1：同一商品有多个 ACTIVE Award' AS issue_type,
    ri.id AS rfq_item_id,
    ri.product_name,
    ri.item_status,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT s.username ORDER BY s.username SEPARATOR ', ') AS suppliers,
    GROUP_CONCAT(DISTINCT a.id ORDER BY a.id SEPARATOR ', ') AS award_ids,
    r.rfq_no,
    r.id AS rfq_id
FROM rfq_items ri
INNER JOIN awards a ON a.rfq_id = ri.rfq_id
INNER JOIN award_items ai ON ai.award_id = a.id AND ai.rfq_item_id = ri.id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
INNER JOIN rfqs r ON r.id = ri.rfq_id
WHERE a.status = 'ACTIVE'
  AND ri.item_status = 'AWARDED'
GROUP BY ri.id, ri.product_name, ri.item_status, r.rfq_no, r.id
HAVING COUNT(DISTINCT a.id) > 1
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 2. 检查商品状态与 Award 的一致性
-- ============================================
-- 2.1 商品状态是 AWARDED，但没有对应的 ACTIVE Award
SELECT 
    '问题2.1：商品状态是 AWARDED，但没有 ACTIVE Award' AS issue_type,
    ri.id AS rfq_item_id,
    ri.product_name,
    ri.item_status,
    r.rfq_no,
    r.id AS rfq_id,
    r.status AS rfq_status
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfq_id
WHERE ri.item_status = 'AWARDED'
  AND NOT EXISTS (
    SELECT 1 
    FROM awards a
    INNER JOIN award_items ai ON ai.award_id = a.id AND ai.rfq_item_id = ri.id
    WHERE a.rfq_id = ri.rfq_id
      AND a.status = 'ACTIVE'
  )
ORDER BY r.rfq_no, ri.product_name;

-- 2.2 商品状态不是 AWARDED，但有对应的 ACTIVE Award
SELECT 
    '问题2.2：商品状态不是 AWARDED，但有 ACTIVE Award' AS issue_type,
    ri.id AS rfq_item_id,
    ri.product_name,
    ri.item_status,
    COUNT(DISTINCT a.id) AS active_award_count,
    GROUP_CONCAT(DISTINCT s.username ORDER BY s.username SEPARATOR ', ') AS suppliers,
    r.rfq_no,
    r.id AS rfq_id
FROM rfq_items ri
INNER JOIN awards a ON a.rfq_id = ri.rfq_id
INNER JOIN award_items ai ON ai.award_id = a.id AND ai.rfq_item_id = ri.id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
INNER JOIN rfqs r ON r.id = ri.rfq_id
WHERE a.status = 'ACTIVE'
  AND ri.item_status != 'AWARDED'
GROUP BY ri.id, ri.product_name, ri.item_status, r.rfq_no, r.id
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 3. 检查 AwardItem 记录是否完整
-- ============================================
-- 3.1 ACTIVE Award 没有对应的 AwardItem 记录
SELECT 
    '问题3.1：ACTIVE Award 没有对应的 AwardItem 记录' AS issue_type,
    a.id AS award_id,
    a.rfq_id,
    r.rfq_no,
    s.username AS supplier_name,
    a.status AS award_status,
    COUNT(ai.id) AS award_item_count
FROM awards a
INNER JOIN rfqs r ON r.id = a.rfq_id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
LEFT JOIN award_items ai ON ai.award_id = a.id
WHERE a.status = 'ACTIVE'
GROUP BY a.id, a.rfq_id, r.rfq_no, s.username, a.status
HAVING COUNT(ai.id) = 0
ORDER BY r.rfq_no, s.username;

-- 3.2 AwardItem 对应的 Award 状态不是 ACTIVE
SELECT 
    '问题3.2：AwardItem 对应的 Award 状态不是 ACTIVE' AS issue_type,
    ai.id AS award_item_id,
    ai.award_id,
    ai.rfq_item_id,
    ri.product_name,
    a.status AS award_status,
    r.rfq_no,
    s.username AS supplier_name
FROM award_items ai
INNER JOIN awards a ON a.id = ai.award_id
INNER JOIN rfq_items ri ON ri.id = ai.rfq_item_id
INNER JOIN rfqs r ON r.id = ri.rfq_id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
WHERE a.status != 'ACTIVE'
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 4. 检查中标供应商选择是否正确（一口价逻辑）
-- ============================================
-- 4.1 检查是否有满足一口价的报价，但中标供应商不满足一口价
SELECT 
    '问题4.1：有满足一口价的报价，但中标供应商不满足一口价' AS issue_type,
    ri.id AS rfq_item_id,
    ri.product_name,
    ri.instant_price,
    ri.max_price,
    a.id AS award_id,
    s_award.username AS awarded_supplier,
    ai.price AS awarded_price,
    q_award.submitted_at AS awarded_submitted_at,
    s_instant.username AS instant_price_supplier,
    qi_instant.price AS instant_price_quote_price,
    q_instant.submitted_at AS instant_price_submitted_at,
    r.rfq_no
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfq_id
INNER JOIN awards a ON a.rfq_id = ri.rfq_id
INNER JOIN award_items ai ON ai.award_id = a.id AND ai.rfq_item_id = ri.id
INNER JOIN quotes q_award ON q_award.id = a.quote_id
INNER JOIN users s_award ON s_award.id = q_award.supplier_id
INNER JOIN quote_items qi_award ON qi_award.id = ai.quote_item_id
-- 查找是否有满足一口价且更早提交的报价
INNER JOIN quote_items qi_instant ON qi_instant.rfq_item_id = ri.id
INNER JOIN quotes q_instant ON q_instant.id = qi_instant.quote_id
INNER JOIN users s_instant ON s_instant.id = q_instant.supplier_id
WHERE a.status = 'ACTIVE'
  AND ri.item_status = 'AWARDED'
  AND ri.instant_price IS NOT NULL
  AND CAST(qi_instant.price AS DECIMAL(10, 2)) <= CAST(ri.instant_price AS DECIMAL(10, 2))
  AND q_instant.submitted_at < q_award.submitted_at
  AND CAST(ai.price AS DECIMAL(10, 2)) > CAST(ri.instant_price AS DECIMAL(10, 2))
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 5. 检查中标供应商选择是否正确（最低价逻辑）
-- ============================================
-- 5.1 检查是否有价格更低的报价，但中标供应商不是最低价
SELECT 
    '问题5.1：有价格更低的报价，但中标供应商不是最低价' AS issue_type,
    ri.id AS rfq_item_id,
    ri.product_name,
    ri.instant_price,
    ri.max_price,
    a.id AS award_id,
    s_award.username AS awarded_supplier,
    ai.price AS awarded_price,
    q_award.submitted_at AS awarded_submitted_at,
    s_lower.username AS lower_price_supplier,
    qi_lower.price AS lower_price_quote_price,
    q_lower.submitted_at AS lower_price_submitted_at,
    r.rfq_no
FROM rfq_items ri
INNER JOIN rfqs r ON r.id = ri.rfq_id
INNER JOIN awards a ON a.rfq_id = ri.rfq_id
INNER JOIN award_items ai ON ai.award_id = a.id AND ai.rfq_item_id = ri.id
INNER JOIN quotes q_award ON q_award.id = a.quote_id
INNER JOIN users s_award ON s_award.id = q_award.supplier_id
INNER JOIN quote_items qi_award ON qi_award.id = ai.quote_item_id
-- 查找是否有价格更低的报价
INNER JOIN quote_items qi_lower ON qi_lower.rfq_item_id = ri.id
INNER JOIN quotes q_lower ON q_lower.id = qi_lower.quote_id
INNER JOIN users s_lower ON s_lower.id = q_lower.supplier_id
WHERE a.status = 'ACTIVE'
  AND ri.item_status = 'AWARDED'
  AND (ri.instant_price IS NULL OR CAST(ai.price AS DECIMAL(10, 2)) > CAST(ri.instant_price AS DECIMAL(10, 2)))
  AND CAST(qi_lower.price AS DECIMAL(10, 2)) < CAST(ai.price AS DECIMAL(10, 2))
  AND q_lower.status IN ('SUBMITTED', 'AWARDED')
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 6. 检查 bestQuoteId 选择是否正确
-- ============================================
-- 6.1 检查 Award 的 quoteId 是否对应包含最多中标商品的 Quote
SELECT 
    '问题6.1：Award 的 quoteId 可能不是包含最多中标商品的 Quote' AS issue_type,
    a.id AS award_id,
    a.rfq_id,
    r.rfq_no,
    s.username AS supplier_name,
    a.quote_id AS current_quote_id,
    COUNT(DISTINCT ai_current.rfq_item_id) AS current_quote_awarded_items,
    q_best.id AS best_quote_id,
    COUNT(DISTINCT ai_best.rfq_item_id) AS best_quote_awarded_items,
    q_best.submitted_at AS best_quote_submitted_at
FROM awards a
INNER JOIN rfqs r ON r.id = a.rfq_id
INNER JOIN quotes q_current ON q_current.id = a.quote_id
INNER JOIN users s ON s.id = q_current.supplier_id
INNER JOIN award_items ai_current ON ai_current.award_id = a.id
INNER JOIN quote_items qi_current ON qi_current.id = ai_current.quote_item_id
-- 查找该供应商包含最多中标商品的 Quote
LEFT JOIN (
    SELECT 
        q.supplier_id,
        q.rfq_id,
        q.id,
        q.submitted_at,
        COUNT(DISTINCT ai.rfq_item_id) AS awarded_item_count
    FROM quotes q
    INNER JOIN award_items ai ON ai.quote_item_id IN (
        SELECT qi.id FROM quote_items qi WHERE qi.quote_id = q.id
    )
    INNER JOIN awards a ON a.id = ai.award_id AND a.status = 'ACTIVE'
    WHERE q.rfq_id = a.rfq_id
    GROUP BY q.supplier_id, q.rfq_id, q.id, q.submitted_at
) q_best ON q_best.supplier_id = s.id AND q_best.rfq_id = a.rfq_id
LEFT JOIN award_items ai_best ON ai_best.quote_item_id IN (
    SELECT qi.id FROM quote_items qi WHERE qi.quote_id = q_best.id
) AND ai_best.award_id = a.id
WHERE a.status = 'ACTIVE'
  AND q_best.id IS NOT NULL
  AND q_best.id != a.quote_id
  AND q_best.awarded_item_count > (
    SELECT COUNT(DISTINCT ai2.rfq_item_id)
    FROM award_items ai2
    INNER JOIN quote_items qi2 ON qi2.id = ai2.quote_item_id
    WHERE ai2.award_id = a.id
      AND qi2.quote_id = a.quote_id
  )
GROUP BY a.id, a.rfq_id, r.rfq_no, s.username, a.quote_id, q_best.id, q_best.submitted_at
ORDER BY r.rfq_no, s.username;

-- ============================================
-- 7. 检查询价单状态与商品状态的一致性
-- ============================================
-- 7.1 询价单已关闭，但商品状态不是 AWARDED 或 PENDING
SELECT 
    '问题7.1：询价单已关闭，但商品状态异常' AS issue_type,
    r.id AS rfq_id,
    r.rfq_no,
    r.status AS rfq_status,
    COUNT(*) AS abnormal_items_count,
    GROUP_CONCAT(DISTINCT ri.item_status ORDER BY ri.item_status SEPARATOR ', ') AS item_statuses
FROM rfqs r
INNER JOIN rfq_items ri ON ri.rfq_id = r.id
WHERE r.status IN ('CLOSED', 'AWARDED')
  AND ri.item_status NOT IN ('AWARDED', 'PENDING', 'OUT_OF_STOCK')
GROUP BY r.id, r.rfq_no, r.status
ORDER BY r.rfq_no;

-- ============================================
-- 8. 检查 AwardItem 的 quoteItemId 是否正确
-- ============================================
-- 8.1 AwardItem 的 quoteItemId 不属于对应的 Award 的 quote
SELECT 
    '问题8.1：AwardItem 的 quoteItemId 不属于对应的 Award 的 quote' AS issue_type,
    ai.id AS award_item_id,
    ai.award_id,
    ai.quote_item_id,
    ai.rfq_item_id,
    ri.product_name,
    a.quote_id,
    qi.quote_id AS quote_item_quote_id,
    r.rfq_no,
    s.username AS supplier_name
FROM award_items ai
INNER JOIN awards a ON a.id = ai.award_id
INNER JOIN quote_items qi ON qi.id = ai.quote_item_id
INNER JOIN rfq_items ri ON ri.id = ai.rfq_item_id
INNER JOIN rfqs r ON r.id = ri.rfq_id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
WHERE qi.quote_id != a.quote_id
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 9. 检查 AwardItem 的价格是否与 quoteItem 的价格一致
-- ============================================
-- 9.1 AwardItem 的价格与 quoteItem 的价格不一致
SELECT 
    '问题9.1：AwardItem 的价格与 quoteItem 的价格不一致' AS issue_type,
    ai.id AS award_item_id,
    ai.award_id,
    ai.quote_item_id,
    ai.rfq_item_id,
    ri.product_name,
    ai.price AS award_item_price,
    qi.price AS quote_item_price,
    ABS(CAST(ai.price AS DECIMAL(10, 2)) - CAST(qi.price AS DECIMAL(10, 2))) AS price_diff,
    r.rfq_no,
    s.username AS supplier_name
FROM award_items ai
INNER JOIN awards a ON a.id = ai.award_id
INNER JOIN quote_items qi ON qi.id = ai.quote_item_id
INNER JOIN rfq_items ri ON ri.id = ai.rfq_item_id
INNER JOIN rfqs r ON r.id = ri.rfq_id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
WHERE ABS(CAST(ai.price AS DECIMAL(10, 2)) - CAST(qi.price AS DECIMAL(10, 2))) > 0.01
ORDER BY r.rfq_no, ri.product_name;

-- ============================================
-- 10. 检查 CANCELLED Award 是否还有对应的 AwardItem
-- ============================================
-- 10.1 CANCELLED Award 还有对应的 AwardItem（应该被删除）
SELECT 
    '问题10.1：CANCELLED Award 还有对应的 AwardItem' AS issue_type,
    a.id AS award_id,
    a.rfq_id,
    r.rfq_no,
    s.username AS supplier_name,
    a.status AS award_status,
    a.cancellation_reason,
    COUNT(ai.id) AS award_item_count
FROM awards a
INNER JOIN rfqs r ON r.id = a.rfq_id
INNER JOIN quotes q ON q.id = a.quote_id
INNER JOIN users s ON s.id = q.supplier_id
INNER JOIN award_items ai ON ai.award_id = a.id
WHERE a.status = 'CANCELLED'
GROUP BY a.id, a.rfq_id, r.rfq_no, s.username, a.status, a.cancellation_reason
HAVING COUNT(ai.id) > 0
ORDER BY r.rfq_no, s.username;

-- ============================================
-- 11. 统计汇总
-- ============================================
SELECT 
    '统计汇总' AS summary_type,
    COUNT(DISTINCT r.id) AS total_rfqs,
    COUNT(DISTINCT ri.id) AS total_rfq_items,
    COUNT(DISTINCT CASE WHEN ri.item_status = 'AWARDED' THEN ri.id END) AS awarded_items,
    COUNT(DISTINCT CASE WHEN a.status = 'ACTIVE' THEN a.id END) AS active_awards,
    COUNT(DISTINCT ai.id) AS total_award_items,
    COUNT(DISTINCT CASE WHEN a.status = 'ACTIVE' THEN ai.id END) AS active_award_items
FROM rfqs r
LEFT JOIN rfq_items ri ON ri.rfq_id = r.id
LEFT JOIN awards a ON a.rfq_id = r.id
LEFT JOIN award_items ai ON ai.award_id = a.id;

