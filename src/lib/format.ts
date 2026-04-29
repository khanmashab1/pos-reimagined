export const fmt = (n: number | string | null | undefined) => {
  const v = Number(n ?? 0);
  return "Rs. " + v.toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const today = () => new Date().toISOString().slice(0, 10);
