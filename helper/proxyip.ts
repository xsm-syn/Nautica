import { appendFileSync } from "node:fs";

interface ProxyStruct {
  address: string;
  port: number;
  country: string;
  org: string;
}

interface ProxyTestResult {
  error: boolean;
  message?: string;
  result?: {
    proxy: string;
    proxyip: boolean;
    ip: string;
    port: number;
    delay: number;
    country: string;
    asOrganization: string;
  };
}

const KV_PAIR_PROXY_FILE = "./kvProxyList.json";
const RAW_PROXY_LIST_FILE = "./rawProxyList.txt";
const PROXY_LIST_FILE = "./proxyList.txt";
const IP_RESOLVER_DOMAIN = "https://id1.foolvpn.me/api/v1/check";
const CONCURRENCY = 99;

const CHECK_QUEUE: string[] = [];

async function readProxyList(): Promise<ProxyStruct[]> {
  const proxyList: ProxyStruct[] = [];
  const proxyListString = (await Bun.file(RAW_PROXY_LIST_FILE).text()).split("\n");

  for (const proxy of proxyListString) {
    const [address, port, ...countryParts] = proxy.split(",");
    const country = countryParts[0].trim();
    const org = countryParts.slice(1).join(",").trim();

    proxyList.push({
      address,
      port: parseInt(port),
      country,
      org,
    });
  }

  return proxyList;
}

async function checkProxy(proxyAddress: string, proxyPort: number): Promise<ProxyTestResult> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 5000);

  try {
    const res = await Bun.fetch(IP_RESOLVER_DOMAIN + `?ip=${proxyAddress}:${proxyPort}`, {
      signal: controller.signal,
    });

    if (res.status == 200) {
      return {
        error: false,
        result: await res.json(),
      };
    } else {
      throw new Error(res.statusText);
    }
  } catch (e: any) {
    return {
      error: true,
      message: e.message,
    };
  }
}

(async () => {
  const proxyList = await readProxyList();
  const proxyChecked: string[] = [];
  const uniqueRawProxies: string[] = [];
  const activeProxyList: string[] = [];
  const kvPair: any = {};

  let proxySaved = 0;

  for (const proxy of proxyList) {
    const proxyKey = `${proxy.address}:${proxy.port}`;
    if (!proxyChecked.includes(proxyKey)) {
      proxyChecked.push(proxyKey);
      uniqueRawProxies.push(`${proxy.address},${proxy.port},${proxy.country},${proxy.org.replaceAll(/[+]/g, " ")}`);
    } else {
      continue;
    }

    CHECK_QUEUE.push(proxyKey);
    checkProxy(proxy.address, proxy.port)
      .then((res) => {
        if (!res.error && res.result?.proxyip === true && res.result.country) {
          activeProxyList.push(
            `${res.result?.proxy},${res.result?.port},${res.result?.country},${res.result?.asOrganization}`
          );

          if (kvPair[res.result.country] == undefined) kvPair[res.result.country] = [];
          if (kvPair[res.result.country].length < 10) {
            kvPair[res.result.country].push(`${res.result.proxy}:${res.result.port}`);
          }

          proxySaved += 1;
          console.log(`[${CHECK_QUEUE.length}] Proxy disimpan:`, proxySaved);
        }
      })
      .finally(() => {
        CHECK_QUEUE.pop();
      });

    while (CHECK_QUEUE.length >= CONCURRENCY) {
      await Bun.sleep(1);
    }
  }

  while (CHECK_QUEUE.length) {
    await Bun.sleep(1);
  }

  uniqueRawProxies.sort(sortByPriority);
  activeProxyList.sort(sortByPriority);

  Bun.write(KV_PAIR_PROXY_FILE, JSON.stringify(kvPair, null, "  "));
  Bun.write(RAW_PROXY_LIST_FILE, uniqueRawProxies.join("\n"));
  Bun.write(PROXY_LIST_FILE, activeProxyList.join("\n"));

  console.log(`Waktu proses: ${(Bun.nanoseconds() / 1000000000).toFixed(2)} detik`);
})();

function sortByPriority(a: string, b: string) {
  const priority = ["ID", "SG", "US", "KR", "JP", "CN", "HK", "MY"];
  const aCountry = a.split(",")[2];
  const bCountry = b.split(",")[2];

  const aIndex = priority.indexOf(aCountry);
  const bIndex = priority.indexOf(bCountry);

  if (aIndex !== -1 && bIndex !== -1) {
    return aIndex - bIndex;
  } else if (aIndex !== -1) {
    return -1;
  } else if (bIndex !== -1) {
    return 1;
  }

  return aCountry.localeCompare(bCountry);
}
