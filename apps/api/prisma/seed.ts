import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // 创建默认用户
  const adminPassword = await bcrypt.hash('admin123', 10);
  const buyerPassword = await bcrypt.hash('buyer123', 10);
  const supplierPassword = await bcrypt.hash('supplier123', 10);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      email: 'admin@example.com',
      username: '管理员',
      password: adminPassword,
      role: 'ADMIN',
    },
  });

  const buyer = await prisma.user.upsert({
    where: { email: 'buyer@example.com' },
    update: {},
    create: {
      email: 'buyer@example.com',
      username: '采购员',
      password: buyerPassword,
      role: 'BUYER',
    },
  });

  const supplier = await prisma.user.upsert({
    where: { email: 'supplier@example.com' },
    update: {},
    create: {
      email: 'supplier@example.com',
      username: '供应商',
      password: supplierPassword,
      role: 'SUPPLIER',
    },
  });

  // 创建默认门店
  const store = await prisma.store.upsert({
    where: { code: 'STORE001' },
    update: {},
    create: {
      name: '总店',
      code: 'STORE001',
      address: '示例地址',
      contact: '13800138000',
    },
  });

  // 创建测试询价单（如果不存在）
  // 确保截止时间在未来（至少1小时后）
  const futureDate = new Date();
  futureDate.setHours(futureDate.getHours() + 24); // 24小时后截止，确保不会过期

  const testRfq1 = await prisma.rfq.upsert({
    where: { rfqNo: 'RFQ-TEST-001' },
    update: {
      // 如果已存在，更新截止时间为未来时间
      deadline: futureDate,
      status: 'PUBLISHED',
    },
    create: {
      rfqNo: 'RFQ-TEST-001',
      title: '测试询价单 - 模型玩具商品采购',
      description: '需要采购一批模型玩具商品，包含多种款式',
      type: 'AUCTION',
      status: 'PUBLISHED',
      deadline: futureDate,
      buyerId: buyer.id,
      storeId: store.id,
    },
  });

  const testRfq2 = await prisma.rfq.upsert({
    where: { rfqNo: 'RFQ-TEST-002' },
    update: {
      // 如果已存在，更新截止时间为未来时间
      deadline: futureDate,
      status: 'PUBLISHED',
    },
    create: {
      rfqNo: 'RFQ-TEST-002',
      title: '测试询价单 - 固定价格采购',
      description: '固定价格采购，欢迎报价',
      type: 'FIXED_PRICE',
      status: 'PUBLISHED',
      deadline: futureDate,
      buyerId: buyer.id,
      storeId: store.id,
    },
  });

  // 创建更多测试询价单
  const testRfq3 = await prisma.rfq.upsert({
    where: { rfqNo: 'RFQ-TEST-003' },
    update: {
      deadline: futureDate,
      status: 'PUBLISHED',
    },
    create: {
      rfqNo: 'RFQ-TEST-003',
      title: '测试询价单 - 正常供货采购',
      description: '正常供货采购，欢迎供应商报价',
      type: 'NORMAL',
      status: 'PUBLISHED',
      deadline: futureDate,
      buyerId: buyer.id,
      storeId: store.id,
    },
  });

  console.log('✅ Seed data created:', { 
    admin, 
    buyer, 
    supplier, 
    store, 
    testRfq1, 
    testRfq2,
    testRfq3,
  });
  
  console.log('📋 测试询价单截止时间:', futureDate.toISOString());
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

