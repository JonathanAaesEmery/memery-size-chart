import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useNavigation, useActionData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import prisma from "../db.server";

async function getSetting(shop: string, key: string, fallback = "") {
  const row = await prisma.globalSettings.findUnique({ where: { shop_settingKey: { shop, settingKey: key } } });
  return row?.settingValue ?? fallback;
}

async function setSetting(shop: string, key: string, value: string) {
  await prisma.globalSettings.upsert({
    where: { shop_settingKey: { shop, settingKey: key } },
    update: { settingValue: value },
    create: { shop, settingKey: key, settingValue: value },
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  const [buttonText, buttonColor, defaultUnit] = await Promise.all([
    getSetting(shop, "button_text", "Size Guide"),
    getSetting(shop, "button_color", "#000000"),
    getSetting(shop, "default_unit", "cm"),
  ]);

  return { buttonText, buttonColor, defaultUnit };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const shop = session.shop;

  const buttonText = (formData.get("buttonText") as string)?.trim() || "Size Guide";
  const buttonColor = (formData.get("buttonColor") as string) || "#000000";
  const defaultUnit = (formData.get("defaultUnit") as string) || "cm";

  await Promise.all([
    setSetting(shop, "button_text", buttonText),
    setSetting(shop, "button_color", buttonColor),
    setSetting(shop, "default_unit", defaultUnit),
  ]);

  return { success: true };
};

export default function SettingsPage() {
  const { buttonText, buttonColor, defaultUnit } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const navigation = useNavigation();
  const isLoading = navigation.state !== "idle";

  return (
    <s-page heading="Settings">
      {actionData?.success && (
        <s-banner tone="success" style={{ marginBottom: "16px" }}>
          Settings saved.
        </s-banner>
      )}

      <s-section heading="Button appearance">
        <form method="POST">
          <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Button text
              </label>
              <input
                name="buttonText"
                defaultValue={buttonText}
                style={{
                  width: "100%",
                  maxWidth: "300px",
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
                placeholder="Size Guide"
              />
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Button color
              </label>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  name="buttonColor"
                  type="color"
                  defaultValue={buttonColor}
                  style={{ width: "48px", height: "36px", padding: "2px", border: "1px solid #c9cccf", borderRadius: "4px", cursor: "pointer" }}
                />
                <span style={{ fontSize: "13px", color: "#6d7175" }}>
                  Color of the size guide button on product pages
                </span>
              </div>
            </div>
            <div>
              <label style={{ display: "block", marginBottom: "4px", fontWeight: 500 }}>
                Default measurement unit
              </label>
              <select
                name="defaultUnit"
                defaultValue={defaultUnit}
                style={{
                  padding: "8px 12px",
                  border: "1px solid #c9cccf",
                  borderRadius: "4px",
                  fontSize: "14px",
                }}
              >
                <option value="cm">Centimeters (cm)</option>
                <option value="inch">Inches (inch)</option>
              </select>
            </div>
            <div>
              <s-button submit disabled={isLoading}>Save settings</s-button>
            </div>
          </div>
        </form>
      </s-section>

      <s-section heading="Theme setup" slot="aside">
        <s-paragraph>
          To show size charts on your product pages, add the <strong>Size Chart Button</strong> block
          to your theme.
        </s-paragraph>
        <s-paragraph>
          Go to <strong>Online Store → Themes → Customize</strong>, open a product page,
          and add the block from the app section.
        </s-paragraph>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
