/**
 * pdfjs ships its worker as an ESM file with no type declaration. It is
 * imported purely for its side effect — registering the worker in this module
 * graph so the bundler emits it and pdfjs never has to resolve a path at
 * runtime (see lib/ingest.ts).
 */
declare module "pdfjs-dist/legacy/build/pdf.worker.mjs";
