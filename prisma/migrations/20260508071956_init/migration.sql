-- CreateTable
CREATE TABLE "SizeChart" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultUnit" TEXT NOT NULL DEFAULT 'cm',
    "imageLayout" TEXT NOT NULL DEFAULT 'above',
    "instructionsHtml" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "SizeChartColumn" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columnType" TEXT NOT NULL DEFAULT 'measurement',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartColumn_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SizeChartRow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartRow_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SizeChartCell" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" TEXT,
    CONSTRAINT "SizeChartCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SizeChartRow" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SizeChartCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "SizeChartColumn" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SizeChartImage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "chartId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartImage_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "productHandle" TEXT,
    "productId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductMapping_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "FallbackMapping" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "mappingType" TEXT NOT NULL,
    "mappingValue" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FallbackMapping_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shop" TEXT NOT NULL,
    "settingKey" TEXT NOT NULL,
    "settingValue" TEXT
);

-- CreateIndex
CREATE UNIQUE INDEX "SizeChartCell_rowId_columnId_key" ON "SizeChartCell"("rowId", "columnId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalSettings_shop_settingKey_key" ON "GlobalSettings"("shop", "settingKey");
