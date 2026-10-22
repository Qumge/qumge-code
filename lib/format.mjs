const DASH = "—";

function usd(micro) {
  return `$${(Number(micro || 0) / 1_000_000).toFixed(2)}`;
}

function pricePerMillion(value) {
  return value === null || value === undefined ? DASH : `$${Number(value).toFixed(2)}`;
}

function context(value) {
  return value ? `${Math.round(Number(value) / 1000)}k ctx` : `${DASH} ctx`;
}

function capabilities(caps = {}) {
  const words = [];
  if (caps.tools) words.push("tools");
  if (caps.vision) words.push("vision");
  return words.length ? words.join(", ") : "no tools";
}

export function formatBalance(json) {
  const balanceMicro = json.balance_micro_usd ?? Math.round((json.balance || 0) * 1_000_000);
  const topupMicro = json.buckets?.topup_micro_usd ?? 0;
  const incomeMicro = json.buckets?.income_micro_usd ?? 0;
  const withdrawableMicro = json.withdrawable_micro_usd ?? Math.round((json.withdrawable || 0) * 1_000_000);
  const monthlyMicro = json.monthly_income_micro_usd ?? Math.round((json.monthly_income || 0) * 1_000_000);

  return [
    `Balance ${usd(balanceMicro)} (top-up ${usd(topupMicro)} + earnings ${usd(incomeMicro)})`,
    `Withdrawable ${usd(withdrawableMicro)}`,
    `Earnings this month ${usd(monthlyMicro)}`,
    json.email || "account email unavailable"
  ];
}

export function formatModels(entries = []) {
  return entries.map((entry) => {
    const star = entry.featured ? "★ " : "  ";
    const name = `${entry.display_name || entry.id} (${entry.id})`;
    return (
      star +
      name +
      ` — in ${pricePerMillion(entry.input_price_per_mtoken_usd)}` +
      ` / out ${pricePerMillion(entry.output_price_per_mtoken_usd)} per M` +
      ` — ${context(entry.context_window)}` +
      ` — ${capabilities(entry.capabilities)}`
    );
  });
}
