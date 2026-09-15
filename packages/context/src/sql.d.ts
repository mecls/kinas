// Migrations are imported as text (`with { type: "text" }`) so the compiled CLI carries them.
declare module "*.sql" {
  const text: string;
  export default text;
}
