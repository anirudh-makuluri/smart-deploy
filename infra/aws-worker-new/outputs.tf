output "instance_id" {
  description = "EC2 worker instance ID"
  value       = aws_instance.worker.id
}

output "instance_public_ip" {
  description = "Public IP of the worker instance"
  value       = var.assign_eip ? aws_eip.worker[0].public_ip : aws_instance.worker.public_ip
}

output "worker_dns_record" {
  description = "Worker DNS record if Route53 domain is configured"
  value       = var.domain_name != "" ? aws_route53_record.worker[0].fqdn : ""
}

output "worker_origin_example" {
  description = "Example websocket origin to set as NEXT_PUBLIC_WS_URL"
  value       = var.domain_name != "" ? "wss://${var.worker_subdomain}.${var.domain_name}" : ""
}
