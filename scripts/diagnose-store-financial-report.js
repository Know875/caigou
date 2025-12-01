/**
 * 诊断门店财务报表数据为0的原因
 * 使用方法: node scripts/diagnose-store-financial-report.js <门店名称或ID>
 * 
 * 例如: node scripts/diagnose-store-financial-report.js "飞翼模玩"
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function diagnoseStoreFinancialReport(storeIdentifier) {
  try {
    console.log(`\n🔍 开始诊断门店财务报表: ${storeIdentifier}\n`);

    // 1. 查找门店
    let store;
    if (storeIdentifier.match(/^[a-zA-Z0-9]+$/)) {
      // 看起来是ID
      store = await prisma.store.findUnique({
        where: { id: storeIdentifier },
      });
    } else {
      // 看起来是名称
      store = await prisma.store.findFirst({
        where: {
          name: {
            contains: storeIdentifier,
          },
        },
      });
    }

    if (!store) {
      console.log('❌ 未找到门店:', storeIdentifier);
      console.log('\n可用的门店列表:');
      const allStores = await prisma.store.findMany({
        select: { id: true, name: true, code: true },
      });
      allStores.forEach(s => {
        console.log(`  - ${s.name} (ID: ${s.id}, 代码: ${s.code || 'N/A'})`);
      });
      return;
    }

    console.log(`✅ 找到门店: ${store.name} (ID: ${store.id}, 代码: ${store.code || 'N/A'})\n`);

    // 2. 查询该门店的所有RFQ
    const allRfqs = await prisma.rfq.findMany({
      where: {
        storeId: store.id,
      },
      include: {
        items: {
          include: {
            quoteItems: {
              include: {
                quote: {
                  include: {
                    supplier: {
                      select: {
                        id: true,
                        username: true,
                      },
                    },
                  },
                },
              },
            },
            shipments: {
              where: {
                source: 'SUPPLIER',
              },
            },
          },
        },
      },
      orderBy: {
        closeTime: 'desc',
      },
    });

    console.log(`📋 该门店共有 ${allRfqs.length} 个询价单\n`);

    if (allRfqs.length === 0) {
      console.log('❌ 该门店没有任何询价单，这是数据为0的主要原因！');
      return;
    }

    // 3. 分析RFQ状态
    const statusCount = {
      DRAFT: 0,
      PUBLISHED: 0,
      CLOSED: 0,
      AWARDED: 0,
      CANCELLED: 0,
    };

    const closeTimeStats = {
      hasCloseTime: 0,
      noCloseTime: 0,
    };

    allRfqs.forEach(rfq => {
      statusCount[rfq.status] = (statusCount[rfq.status] || 0) + 1;
      if (rfq.closeTime) {
        closeTimeStats.hasCloseTime++;
      } else {
        closeTimeStats.noCloseTime++;
      }
    });

    console.log('📊 RFQ状态统计:');
    Object.entries(statusCount).forEach(([status, count]) => {
      if (count > 0) {
        console.log(`  ${status}: ${count} 个`);
      }
    });
    console.log(`\n📅 截标时间统计:`);
    console.log(`  有截标时间: ${closeTimeStats.hasCloseTime} 个`);
    console.log(`  无截标时间: ${closeTimeStats.noCloseTime} 个\n`);

    // 4. 查询符合条件的RFQ（财务报表会查询的）
    const today = new Date();
    const startOfToday = new Date(today.setHours(0, 0, 0, 0));
    const endOfToday = new Date(today.setHours(23, 59, 59, 999));

    const validRfqs = await prisma.rfq.findMany({
      where: {
        storeId: store.id,
        status: {
          in: ['CLOSED', 'AWARDED'],
        },
        closeTime: {
          not: null,
          gte: startOfToday,
          lte: endOfToday,
        },
      },
      include: {
        items: {
          where: {
            itemStatus: 'AWARDED',
          },
          include: {
            quoteItems: {
              include: {
                quote: {
                  include: {
                    supplier: {
                      select: {
                        id: true,
                        username: true,
                      },
                    },
                  },
                },
              },
            },
            shipments: {
              where: {
                source: 'SUPPLIER',
              },
            },
          },
        },
      },
    });

    console.log(`\n✅ 今日符合条件的RFQ（状态为CLOSED或AWARDED，且有截标时间）: ${validRfqs.length} 个`);

    if (validRfqs.length === 0) {
      console.log('\n❌ 今日没有符合条件的RFQ！');
      console.log('\n可能的原因:');
      console.log('  1. RFQ状态不是CLOSED或AWARDED');
      console.log('  2. RFQ没有截标时间（closeTime为null）');
      console.log('  3. RFQ的截标时间不在今天');
      console.log('\n建议:');
      console.log('  - 检查RFQ的status字段');
      console.log('  - 检查RFQ的closeTime字段');
      console.log('  - 尝试选择不同的日期范围查询财务报表');
    } else {
      // 5. 分析已中标的商品
      let totalAwardedItems = 0;
      let totalAmount = 0;
      const supplierStats = {};

      validRfqs.forEach(rfq => {
        rfq.items.forEach(item => {
          if (item.itemStatus === 'AWARDED' && item.quoteItems && item.quoteItems.length > 0) {
            totalAwardedItems++;
            
            // 找到最低报价
            const validQuoteItems = item.quoteItems.filter(
              qi => qi && qi.quote && qi.quote.supplier && qi.price != null
            );
            
            if (validQuoteItems.length > 0) {
              const sortedQuoteItems = validQuoteItems.sort((a, b) => {
                return parseFloat(a.price.toString()) - parseFloat(b.price.toString());
              });
              
              const bestQuoteItem = sortedQuoteItems[0];
              const itemPrice = Number(bestQuoteItem.price) * (item.quantity || 1);
              totalAmount += itemPrice;
              
              const supplierId = bestQuoteItem.quote.supplierId;
              const supplierName = bestQuoteItem.quote.supplier.username || '未知供应商';
              
              if (!supplierStats[supplierId]) {
                supplierStats[supplierId] = {
                  name: supplierName,
                  count: 0,
                  amount: 0,
                };
              }
              
              supplierStats[supplierId].count++;
              supplierStats[supplierId].amount += itemPrice;
            }
          }
        });
      });

      console.log(`\n📦 已中标商品统计:`);
      console.log(`  商品数量: ${totalAwardedItems} 个`);
      console.log(`  总金额: ¥${totalAmount.toFixed(2)}`);
      
      if (Object.keys(supplierStats).length > 0) {
        console.log(`\n👥 供应商统计:`);
        Object.entries(supplierStats).forEach(([supplierId, stats]) => {
          console.log(`  ${stats.name}: ${stats.count} 个商品, ¥${stats.amount.toFixed(2)}`);
        });
      }

      if (totalAwardedItems === 0) {
        console.log('\n❌ 虽然RFQ符合条件，但没有已中标的商品！');
        console.log('\n可能的原因:');
        console.log('  1. 商品状态不是AWARDED');
        console.log('  2. 商品没有报价项（quoteItems为空）');
        console.log('  3. 报价项无效（没有关联的quote或supplier）');
      }
    }

    // 6. 查询最近30天的数据
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const recentRfqs = await prisma.rfq.findMany({
      where: {
        storeId: store.id,
        status: {
          in: ['CLOSED', 'AWARDED'],
        },
        closeTime: {
          not: null,
          gte: thirtyDaysAgo,
        },
      },
      select: {
        id: true,
        rfqNo: true,
        title: true,
        status: true,
        closeTime: true,
        _count: {
          select: {
            items: {
              where: {
                itemStatus: 'AWARDED',
              },
            },
          },
        },
      },
      orderBy: {
        closeTime: 'desc',
      },
      take: 10,
    });

    if (recentRfqs.length > 0) {
      console.log(`\n📅 最近30天符合条件的RFQ（前10个）:`);
      recentRfqs.forEach(rfq => {
        console.log(`  ${rfq.rfqNo} - ${rfq.title || '无标题'}`);
        console.log(`    状态: ${rfq.status}, 截标时间: ${rfq.closeTime?.toLocaleString('zh-CN')}`);
        console.log(`    已中标商品: ${rfq._count.items} 个`);
      });
      console.log('\n💡 提示: 如果财务报表选择的是"今天"，但RFQ的截标时间不在今天，数据会显示为0');
      console.log('   建议: 尝试选择RFQ截标时间所在的日期查询财务报表');
    }

    // 7. 检查电商采购数据
    const ecommerceItems = await prisma.rfqItem.findMany({
      where: {
        rfq: {
          storeId: store.id,
        },
        source: 'ECOMMERCE',
        itemStatus: {
          in: ['ECOMMERCE_PENDING', 'ECOMMERCE_PAID', 'ECOMMERCE_SHIPPED'],
        },
        updatedAt: {
          gte: startOfToday,
          lte: endOfToday,
        },
      },
      include: {
        rfq: {
          select: {
            rfqNo: true,
          },
        },
      },
    });

    if (ecommerceItems.length > 0) {
      let ecommerceTotal = 0;
      ecommerceItems.forEach(item => {
        if (item.costPrice) {
          ecommerceTotal += Number(item.costPrice) * (item.quantity || 1);
        }
      });
      console.log(`\n🛒 今日电商采购数据:`);
      console.log(`  商品数量: ${ecommerceItems.length} 个`);
      console.log(`  总金额: ¥${ecommerceTotal.toFixed(2)}`);
    }

    console.log('\n✅ 诊断完成！\n');

  } catch (error) {
    console.error('❌ 诊断过程中出错:', error);
  } finally {
    await prisma.$disconnect();
  }
}

// 从命令行参数获取门店标识
const storeIdentifier = process.argv[2];

if (!storeIdentifier) {
  console.log('使用方法: node scripts/diagnose-store-financial-report.js <门店名称或ID>');
  console.log('例如: node scripts/diagnose-store-financial-report.js "飞翼模玩"');
  process.exit(1);
}

diagnoseStoreFinancialReport(storeIdentifier);

