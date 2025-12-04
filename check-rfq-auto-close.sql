-- 检查 RFQ-1764848283116 的自动截单状态

USE caigou;

SELECT '=== RFQ 基本信息 ===' AS section;

SELECT 
    r.id,
    r.rfqNo,
    r.title,
    r.status,
    r.deadline,
    r.closeTime,
    r.createdAt,
    r.updatedAt,
    TIMESTAMPDIFF(SECOND, NOW(), r.deadline) AS seconds_until_deadline,
    TIMESTAMPDIFF(MINUTE, NOW(), r.deadline) AS minutes_until_deadline,
    TIMESTAMPDIFF(HOUR, NOW(), r.deadline) AS hours_until_deadline,
    TIMESTAMPDIFF(DAY, NOW(), r.deadline) AS days_until_deadline,
    CASE 
        WHEN r.deadline <= NOW() THEN '已过期'
        ELSE '未过期'
    END AS deadline_status
FROM rfqs r
WHERE r.rfqNo = 'RFQ-1764848283116' COLLATE utf8mb4_unicode_ci;

SELECT '=== 检查是否有延迟任务（需要检查 Redis/BullMQ） ===' AS section;

-- 注意：延迟任务存储在 Redis 中，无法通过 SQL 查询
-- 需要检查 Redis 或 PM2 日志

SELECT '=== 检查定时任务是否正常运行 ===' AS section;

-- 检查最近关闭的询价单（验证定时任务是否工作）
SELECT 
    r.rfqNo,
    r.status,
    r.deadline,
    r.closeTime,
    TIMESTAMPDIFF(MINUTE, r.deadline, r.closeTime) AS close_delay_minutes
FROM rfqs r
WHERE r.status = 'CLOSED'
  AND r.closeTime IS NOT NULL
  AND r.closeTime >= DATE_SUB(NOW(), INTERVAL 7 DAY)
ORDER BY r.closeTime DESC
LIMIT 10;

SELECT '=== 检查已发布但已过期的询价单（应该被定时任务关闭） ===' AS section;

SELECT 
    r.id,
    r.rfqNo,
    r.title,
    r.status,
    r.deadline,
    TIMESTAMPDIFF(MINUTE, r.deadline, NOW()) AS minutes_past_deadline
FROM rfqs r
WHERE r.status = 'PUBLISHED'
  AND r.deadline <= NOW()
ORDER BY r.deadline DESC;

