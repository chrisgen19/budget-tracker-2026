import { MAX_BREAKDOWN_GROUPS, MAX_BREAKDOWN_LINE_ITEMS } from "@/lib/receipt-limits";
import { renderCategoryRules, type CategoryRule } from "@/lib/category-rules";

/** Per-line-item routing. See `category-rules.ts` for why these are data and not prose. */
export const BREAKDOWN_CATEGORY_RULES: readonly CategoryRule[] = [
  {
    category: "Groceries",
    matches:
      "raw or packaged food to cook, prepare or keep at home: fresh produce, meat, seafood, dairy, eggs, bread, rice, instant noodles, condiments, cooking ingredients, canned food, frozen food, packaged snacks and beverages",
  },
  {
    category: "Food & Dining",
    matches:
      "food already prepared and ready to eat as sold: a hot deli or food-court item, a brewed or made-to-order drink, a restaurant or fast-food line item on the same receipt",
  },
  {
    category: "Personal Care",
    matches:
      "soap, shampoo, toothpaste, deodorant, lotion, tissue paper, toilet paper, napkins, feminine hygiene, cotton buds, razors",
  },
  {
    category: "Home Supplies",
    matches:
      "cleaning supplies (detergent, bleach, dishwashing liquid, floor cleaner), garbage bags, sponges, air freshener, insect spray",
  },
  { category: "Healthcare", matches: "vitamins, medicine, first aid, health supplements" },
  { category: "Shopping", matches: "clothing, electronics, toys, home decor, kitchenware" },
];

const BREAKDOWN_GUIDANCE_RULES: readonly string[] = [
  "For any item not clearly matching the above, match by comparing to the category name",
  "Most items on a supermarket or wet-market receipt are Groceries. Use Food & Dining only for a line that was ready to eat when bought, not for ingredients",
  "Cleaners, garbage bags and sponges on a supermarket receipt are Home Supplies. Never assign a supermarket line item to Housing: Housing is rent and dues, not things bought for the home",
  "When in doubt about a food-adjacent item (e.g. plastic wrap, aluminum foil), put it in Home Supplies",
];

/**
 * The itemisation prompt for POST /api/receipts/breakdown, which groups a receipt's individual
 * line items by category.
 *
 * It lives here rather than inline in the route so it can be asserted on. The route builds its
 * request inside the handler, so a regression in these category rules is unreachable from a unit
 * test and silent in production: a misrouted item still produces a well-formed breakdown. This is
 * a second, independent copy of the routing rules in `receipt-scan.ts` — the two prompts answer
 * different questions (one category for the whole receipt vs one per line item), so they are not
 * merged, but both must name categories that actually exist.
 */
export const buildBreakdownPrompt = (categoryList: string, photoDateStr: string) =>
  `You are an expert receipt analyzer. Read EVERY line item on this receipt and group them by spending category.

If the image is NOT a receipt (e.g. a random photo, screenshot, or document), respond with exactly: {"error": "NOT_A_RECEIPT"}

INSTRUCTIONS:
1. Read every individual item/product on the receipt
2. Assign each item to one of the categories below based on these rules
3. Group items by category and sum their amounts per group
4. Return one entry per category, with the individual line items listed inside

CATEGORIES:
${categoryList}

CATEGORY RULES:
${renderCategoryRules(BREAKDOWN_CATEGORY_RULES, BREAKDOWN_GUIDANCE_RULES)}

RESPONSE FORMAT — return ONLY valid JSON, no markdown or explanation:
{
  "date": "<YYYY-MM-DD — the TRANSACTION/purchase date, usually near the top of the receipt next to the time. IGNORE any 'Date of Issuance', PTU accreditation, permit, or BIR registration dates. Use ${photoDateStr} if unreadable>",
  "dateSource": "<\"OCR\" if you read the date from the receipt, or \"PHOTO_FALLBACK\" if you used the fallback ${photoDateStr} because the date was unreadable. Always include this field.>",
  "items": [
    {
      "amount": <sum of items in this category>,
      "categoryId": "<id>",
      "description": "<store name> - <category name>: <1-2 sample items>",
      "lineItems": [
        { "name": "<item name as printed on receipt>", "amount": <price> }
      ]
    }
  ]
}

RULES:
- The sum of all item amounts should approximately equal the receipt total (small rounding differences are OK)
- Each description should be short: store name, category, and 1-2 sample items (max 80 chars)
- Each lineItems entry is one product/line from the receipt with its exact name and price
- If an item has quantity > 1, multiply to get the total and use a single lineItems entry
- Minimum 1 category group, maximum ${MAX_BREAKDOWN_GROUPS} category groups
- At most ${MAX_BREAKDOWN_LINE_ITEMS} lineItems in any one group; if a group would exceed that, merge its smallest items into a single "Other items" line
- All amounts must be positive numbers. A discount, promo, void or zero-priced line is NOT its own item: subtract it from the item it applies to, or from that group's total, and never emit a zero or negative "amount"
- Do NOT include tax/service charge as a separate item — distribute proportionally or include in the largest group`;
