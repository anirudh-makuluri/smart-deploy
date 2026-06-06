# Optional: wildcard DNS for ECS/ALB deploy URLs (*.deployment_domain → shared ALB).
# Set shared_alb_dns_name after the first deploy creates the shared ALB (see ensureSharedAlb).

locals {
  elb_alias_zone_ids = {
    us-east-1      = "Z35SXDOTRQ7X7K"
    us-east-2      = "Z3AADJGX6KTTL2"
    us-west-1      = "Z368ELLRRE2KJ0"
    us-west-2      = "Z1H1FL5HABSF5"
    eu-west-1      = "Z32O12XQLNTSW2"
    eu-central-1   = "Z215JYRZR1TBD5"
    ap-southeast-1 = "Z1LMS91P8CMLE5"
    ap-southeast-2 = "Z1GM3OXH4ZPM65"
    ap-northeast-1 = "Z14GRHDCWA56QT"
  }

  route53_zone_id = var.route53_hosted_zone_id != "" ? var.route53_hosted_zone_id : (
    var.deployment_domain != "" ? try(data.aws_route53_zone.deployment[0].zone_id, "") : ""
  )
}

data "aws_route53_zone" "deployment" {
  count        = var.deployment_domain != "" && var.route53_hosted_zone_id == "" ? 1 : 0
  name         = var.deployment_domain
  private_zone = false
}

resource "aws_route53_record" "deploy_wildcard" {
  count = var.shared_alb_dns_name != "" && var.deployment_domain != "" && local.route53_zone_id != "" ? 1 : 0

  zone_id = local.route53_zone_id
  name    = "*.${var.deployment_domain}"
  type    = "A"

  alias {
    name                   = startswith(var.shared_alb_dns_name, "dualstack.") ? var.shared_alb_dns_name : "dualstack.${var.shared_alb_dns_name}"
    zone_id                = lookup(local.elb_alias_zone_ids, var.aws_region, "Z1H1FL5HABSF5")
    evaluate_target_health = false
  }
}
