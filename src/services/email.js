const nodemailer = require('nodemailer');
const { renderTemplate } = require('./emailTemplates');

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

async function sendMail({ to, subject, html, attachments }) {
  return transporter.sendMail({
    from: `"Pol-Bram" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    html,
    attachments: attachments || [],
  });
}

async function sendInquiryReceived(customer) {
  const { subject, html } = renderTemplate('inquiry_received', { name: customer.name || '' });
  return sendMail({ to: customer.email, subject, html });
}

async function sendOffer(customer, priceText) {
  const acceptUrl = `${process.env.BASE_URL}/public/accept-offer/${customer.accept_token}`;
  const { subject, html } = renderTemplate('offer', { name: customer.name || '', price: priceText, acceptUrl });
  return sendMail({ to: customer.email, subject, html });
}

async function sendOrderFormToColleague(customer) {
  const colleagueUrl = `${process.env.BASE_URL}/public/colleague/${customer.colleague_token}`;
  const { subject, html } = renderTemplate('order_form_colleague', { name: customer.name || '', colleagueUrl });
  return sendMail({ to: process.env.COLLEAGUE_EMAIL, subject, html });
}

async function sendFinalOrderFormToCustomer(customer, pdfHuBuffer) {
  const approveUrl = `${process.env.BASE_URL}/public/order-approve/${customer.accept_token}`;
  const modifyUrl = `${process.env.BASE_URL}/public/order-modify/${customer.accept_token}`;
  const { subject, html } = renderTemplate('order_form_customer', { name: customer.name || '', approveUrl, modifyUrl });
  return sendMail({
    to: customer.email,
    subject,
    html,
    attachments: [{ filename: `megrendelolap_${customer.name || customer.id}.pdf`, content: pdfHuBuffer }],
  });
}

async function sendAdvanceInvoice(customer, invoiceBuffer, invoiceFilename) {
  const { subject, html } = renderTemplate('invoice', { name: customer.name || '' });
  return sendMail({
    to: customer.email,
    subject,
    html,
    attachments: [{ filename: invoiceFilename || `elolegszamla_${customer.id}.pdf`, content: invoiceBuffer }],
  });
}

async function sendInstalledNotice(customer) {
  const satisfactionUrl = `${process.env.BASE_URL}/public/satisfaction/${customer.satisfaction_token}`;
  const complaintUrl = `${process.env.BASE_URL}/public/complaint/${customer.complaint_token}`;
  const { subject, html } = renderTemplate('installed', { name: customer.name || '', satisfactionUrl, complaintUrl });
  return sendMail({ to: customer.email, subject, html });
}

module.exports = {
  sendMail,
  sendInquiryReceived,
  sendOffer,
  sendOrderFormToColleague,
  sendFinalOrderFormToCustomer,
  sendAdvanceInvoice,
  sendInstalledNotice,
};
