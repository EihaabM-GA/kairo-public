-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreConfig" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoreConnection" (
    "id" TEXT NOT NULL,
    "parentShop" TEXT NOT NULL,
    "childShop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StoreConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncSetting" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "syncTitle" BOOLEAN NOT NULL DEFAULT true,
    "syncDescription" BOOLEAN NOT NULL DEFAULT true,
    "syncImages" BOOLEAN NOT NULL DEFAULT true,
    "syncPrice" BOOLEAN NOT NULL DEFAULT false,
    "syncInventory" BOOLEAN NOT NULL DEFAULT true,
    "syncVendor" BOOLEAN NOT NULL DEFAULT false,
    "syncTags" BOOLEAN NOT NULL DEFAULT true,
    "autoSync" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SyncSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "adjustment" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductMap" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "childProductId" TEXT,
    "parentSku" TEXT,
    "syncedAt" TIMESTAMP(3),

    CONSTRAINT "ProductMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "synced" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StoreConfig_shop_key" ON "StoreConfig"("shop");

-- CreateIndex
CREATE UNIQUE INDEX "StoreConnection_parentShop_childShop_key" ON "StoreConnection"("parentShop", "childShop");

-- CreateIndex
CREATE UNIQUE INDEX "SyncSetting_connectionId_key" ON "SyncSetting"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRule_connectionId_key" ON "PricingRule"("connectionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProductMap_connectionId_parentProductId_key" ON "ProductMap"("connectionId", "parentProductId");

-- AddForeignKey
ALTER TABLE "SyncSetting" ADD CONSTRAINT "SyncSetting_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductMap" ADD CONSTRAINT "ProductMap_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncLog" ADD CONSTRAINT "SyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
