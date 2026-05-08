-- Add chartType to SizeChart
ALTER TABLE "SizeChart" ADD COLUMN "chartType" TEXT NOT NULL DEFAULT 'simple';

-- Add recommendation/input fields to SizeChartColumn
ALTER TABLE "SizeChartColumn" ADD COLUMN "isMatchingKey" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SizeChartColumn" ADD COLUMN "customerInputEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "SizeChartColumn" ADD COLUMN "apparelMeasurementType" TEXT;
ALTER TABLE "SizeChartColumn" ADD COLUMN "inputLabel" TEXT;

-- Add range fields to SizeChartCell
ALTER TABLE "SizeChartCell" ADD COLUMN "minValue" DOUBLE PRECISION;
ALTER TABLE "SizeChartCell" ADD COLUMN "maxValue" DOUBLE PRECISION;
