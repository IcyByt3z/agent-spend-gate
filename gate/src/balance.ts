import { createPublicClient, http, erc20Abi, formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const client = createPublicClient({ chain: baseSepolia, transport: http() });
for (const addr of process.argv.slice(2)) {
  const bal = await client.readContract({ address: USDC, abi: erc20Abi, functionName: "balanceOf", args: [addr as `0x${string}`] });
  console.log(addr, formatUnits(bal, 6), "test USDC");
}
