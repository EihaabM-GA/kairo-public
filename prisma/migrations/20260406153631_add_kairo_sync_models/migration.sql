-- CreateTable
CREATE TABLE "StoreConfig" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "StoreConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "parentShop" TEXT NOT NULL,
    "childShop" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SyncSetting" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "lastSyncAt" DATETIME,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SyncSetting_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PricingRule" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'percentage',
    "adjustment" REAL NOT NULL DEFAULT 0,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PricingRule_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductMap" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "parentProductId" TEXT NOT NULL,
    "childProductId" TEXT,
    "parentSku" TEXT,
    "syncedAt" DATETIME,
    CONSTRAINT "ProductMap_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SyncLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "connectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "synced" INTEGER NOT NULL DEFAULT 0,
    "created" INTEGER NOT NULL DEFAULT 0,
    "updated" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "details" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SyncLog_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "StoreConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
