-- CreateTable
CREATE TABLE "SizeChartTranslation" (
    "id" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "instructionsHtml" TEXT,
    "columnNames" TEXT,

    CONSTRAINT "SizeChartTranslation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SizeChartTranslation_chartId_idx" ON "SizeChartTranslation"("chartId");

-- CreateIndex
CREATE UNIQUE INDEX "SizeChartTranslation_chartId_language_key" ON "SizeChartTranslation"("chartId", "language");

-- AddForeignKey
ALTER TABLE "SizeChartTranslation" ADD CONSTRAINT "SizeChartTranslation_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "SizeChart"("id") ON DELETE CASCADE ON UPDATE CASCADE;
