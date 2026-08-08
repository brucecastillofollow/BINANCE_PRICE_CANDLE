/**
 * Cross-links to sibling services in the Weien Wong platform ecosystem.
 * Rendered in the site footer so crawlers and answer engines can reach every
 * service from any page here.
 */
const SITES = [
  { url: "https://weienwong.online/", anchor: "Weien Wong Platform Hub" },
  { url: "https://bittensor.weienwong.online/", anchor: "Bittensor Subnet Dashboard" },
  { url: "https://reddit.weienwong.online/", anchor: "Reddit Dataset Scraper" },
  { url: "https://twitter.weienwong.online/", anchor: "Twitter / X Dataset Scraper" },
  { url: "https://aicontent.weienwong.online/", anchor: "AI Content Generator" },
  { url: "https://aidetect.weienwong.online/", anchor: "AI Content Detector" },
  { url: "https://voiceagent.weienwong.online/", anchor: "Multilingual Voice Assistant" },
  { url: "https://sport.weienwong.online/", anchor: "Sports Odds Research & Guides" },
  { url: "https://googlemap.weienwong.online/", anchor: "Google Maps Business Lead Finder" }
];

export default function EcosystemLinks() {
  return (
    <footer className="site-footer">
      <nav className="ecosystem-links" aria-label="Weien Wong ecosystem">
        <p className="ecosystem-heading">More from the Weien Wong network</p>
        <ul>
          {SITES.map((site) => (
            <li key={site.url}>
              <a href={site.url}>{site.anchor}</a>
            </li>
          ))}
        </ul>
      </nav>
      <p className="footer-copy">© 2026 Weien Wong · cryptodataset.weienwong.online</p>
    </footer>
  );
}
