-- CreateIndex
CREATE INDEX "FallbackMapping_shop_idx" ON "FallbackMapping"("shop");

-- CreateIndex
CREATE INDEX "FallbackMapping_chartId_idx" ON "FallbackMapping"("chartId");

-- CreateIndex
CREATE INDEX "ProductMapping_shop_idx" ON "ProductMapping"("shop");

-- CreateIndex
CREATE INDEX "ProductMapping_chartId_idx" ON "ProductMapping"("chartId");

-- CreateIndex
CREATE INDEX "SizeChart_shop_idx" ON "SizeChart"("shop");

-- CreateIndex
CREATE INDEX "SizeChartColumn_chartId_idx" ON "SizeChartColumn"("chartId");

-- CreateIndex
CREATE INDEX "SizeChartImage_chartId_idx" ON "SizeChartImage"("chartId");

-- CreateIndex
CREATE INDEX "SizeChartRow_chartId_idx" ON "SizeChartRow"("chartId");
