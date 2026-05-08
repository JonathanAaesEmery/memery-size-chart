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

CREATE TABLE "SizeChart" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "defaultUnit" TEXT NOT NULL DEFAULT 'cm',
    "imageLayout" TEXT NOT NULL DEFAULT 'above',
    "instructionsHtml" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SizeChart_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SizeChartColumn" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columnType" TEXT NOT NULL DEFAULT 'measurement',
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartColumn_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SizeChartRow" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartRow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SizeChartCell" (
    "id" TEXT NOT NULL,
    "rowId" TEXT NOT NULL,
    "columnId" TEXT NOT NULL,
    "value" TEXT,
    CONSTRAINT "SizeChartCell_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SizeChartImage" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "altText" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SizeChartImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProductMapping" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "productHandle" TEXT,
    "productId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "FallbackMapping" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "mappingType" TEXT NOT NULL,
    "mappingValue" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "FallbackMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "GlobalSettings" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "settingKey" TEXT NOT NULL,
    "settingValue" TEXT,
    CONSTRAINT "GlobalSettings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SizeChartCell_rowId_columnId_key" ON "SizeChartCell"("rowId", "columnId");
CREATE UNIQUE INDEX "GlobalSettings_shop_settingKey_key" ON "GlobalSettings"("shop", "settingKey");

ALTER TABLE "SizeChartColumn" ADD CONSTRAINT "SizeChartColumn_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SizeChartRow" ADD CONSTRAINT "SizeChartRow_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SizeChartCell" ADD CONSTRAINT "SizeChartCell_rowId_fkey" FOREIGN KEY ("rowId") REFERENCES "SizeChartRow"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SizeChartCell" ADD CONSTRAINT "SizeChartCell_columnId_fkey" FOREIGN KEY ("columnId") REFERENCES "SizeChartColumn"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SizeChartImage" ADD CONSTRAINT "SizeChartImage_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProductMapping" ADD CONSTRAINT "ProductMapping_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FallbackMapping" ADD CONSTRAINT "FallbackMapping_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
