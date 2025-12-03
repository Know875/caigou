-- 清除财务报表缓存的 Redis 命令
-- 注意：这不是 SQL 脚本，需要在 Redis 中执行

-- 方法 1：清除所有财务报表缓存
-- redis-cli KEYS "financial_report:*" | xargs redis-cli DEL

-- 方法 2：清除特定日期的缓存（2025-11-30）
-- redis-cli DEL "financial_report:day:2025-11-30:all"
-- redis-cli DEL "financial_report:week:2025-11-30:all"
-- redis-cli DEL "financial_report:month:2025-11-30:all"

-- 方法 3：清除特定门店的缓存（如果需要）
-- redis-cli DEL "financial_report:day:2025-11-30:cmigtfyrg0006kq0js638clng"  -- 飞翼模玩

SELECT '请在 Redis 中执行以下命令清除缓存：' AS notice;
SELECT 'redis-cli KEYS "financial_report:*" | xargs redis-cli DEL' AS command;

