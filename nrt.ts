// adapted this from a script someone posted here a while back, was using the
// jito-ts readme example as a base and just bolted the land rate counting on
// top. works fine on my end (windows 11, node 18)

import fs from "fs";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import { searcherClient } from "jito-ts/dist/sdk/block-engine/searcher";
import { Bundle } from "jito-ts/dist/sdk/block-engine/types";
import { isError } from "jito-ts/dist/sdk/block-engine/utils";

// node script.js <keypair path> <block engine url> <tip lamports> <num bundles> <rpc url>
const KEYPAIR_PATH = process.argv[2];
const BLOCK_ENGINE_URL = process.argv[3];
const TIP_LAMPORTS = Number(process.argv[4]);
const NUM_BUNDLES = Number(process.argv[5]);
const RPC_URL = process.argv[6];

function loadKp(p: string) {
  const raw = fs.readFileSync(p, "utf-8");
  const secret = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secret);
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const kp = loadKp(KEYPAIR_PATH);
  console.log("kp", kp.publicKey.toBase58());

  const c = new Connection(RPC_URL, "confirmed");

  // this is the part that does the auth with the block engine, just passing
  // the keypair in like the readme says and it handles the rest
  const sc = searcherClient(BLOCK_ENGINE_URL, kp);

  const tipAccounts = await sc.getTipAccounts();
  const tipAcc = new PublicKey(tipAccounts[0]);
  console.log("tip acc", tipAcc.toBase58());

  let sent = 0;
  let landed = 0;

  // subscribe once up front so we catch results for every bundle below
  sc.onBundleResult(
    (res) => {
      console.log(res);
      if (res.accepted) {
        landed++;
        console.log("landed one!", landed, "/", sent);
      }
    },
    (e) => {
      console.log("bundle result stream error", e);
    },
  );

  for (let i = 0; i < NUM_BUNDLES; i++) {
    try {
      console.log("sending bundle", i);

      const bh = await c.getLatestBlockhash();

      // just a dummy self transfer so theres a real tx in the bundle
      const msg = new TransactionMessage({
        payerKey: kp.publicKey,
        recentBlockhash: bh.blockhash,
        instructions: [
          SystemProgram.transfer({
            fromPubkey: kp.publicKey,
            toPubkey: kp.publicKey,
            lamports: 1000,
          }),
        ],
      }).compileToV0Message();
      const tx = new VersionedTransaction(msg);
      tx.sign([kp]);

      let b: Bundle | Error = new Bundle([], 5);
      b = b.addTransactions(tx);
      if (isError(b)) throw b;
      b = b.addTipTx(kp, TIP_LAMPORTS, tipAcc, bh.blockhash);
      if (isError(b)) throw b;

      const tok = await sc.sendBundle(b);
      console.log("tok", tok); // pretty sure this is the bundle id

      sent++;
    } catch (e) {
      console.log("bundle send failed:", e);
      // just move on to the next one
    }

    await sleep(2000);
  }

  console.log("done sending, waiting a bit for the rest of the results...");
  await sleep(15000);

  const rate = sent === 0 ? 0 : (landed / sent) * 100;
  console.log("sent:", sent, "landed:", landed, "land rate:", rate + "%");
}

main().catch((e) => {
  console.log(e);
});
