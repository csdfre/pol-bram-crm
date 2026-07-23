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

async function sendOffer(customer, priceText, extra) {
  const acceptUrl = `${process.env.BASE_URL}/public/accept-offer/${customer.accept_token}`;
  const modifyUrl = `${process.env.BASE_URL}/public/modify-offer/${customer.accept_token}`;
  const rejectUrl = `${process.env.BASE_URL}/public/reject-offer/${customer.accept_token}`;
  const attachments = [];
  let sketchHtml = '';
  let logoHtml = '';
  if (extra && extra.sketchBuffer) {
    attachments.push({ filename: 'vazlat.png', content: extra.sketchBuffer, cid: 'sketch-image' });
    sketchHtml = `<div style="border:1px solid #e6e8ea;border-radius:8px;padding:10px;text-align:center;margin:16px 0"><img src="cid:sketch-image" alt="Felülnézeti vázlat" style="max-width:100%;height:auto"></div>`;
  }
  if (extra && extra.logoBuffer) {
    attachments.push({ filename: 'logo.png', content: extra.logoBuffer, cid: 'pol-bram-logo' });
    logoHtml = `<img src="cid:pol-bram-logo" alt="Pol-Bram" style="height:32px;background:#fff;padding:6px 10px;border-radius:4px">`;
  }
  const { subject, html } = renderTemplate('offer', {
    name: customer.name || '',
    price: priceText,
    acceptUrl, modifyUrl, rejectUrl,
    detailsHtml: (extra && extra.detailsHtml) || '',
    sketchHtml,
    logoHtml,
    cashNoteHtml: (extra && extra.cashNoteHtml) || '',
  });
  return sendMail({ to: customer.email, subject, html, attachments });
}

async function sendOfferReminder(customer, priceText) {
  const acceptUrl = `${process.env.BASE_URL}/public/accept-offer/${customer.accept_token}`;
  const modifyUrl = `${process.env.BASE_URL}/public/modify-offer/${customer.accept_token}`;
  const rejectUrl = `${process.env.BASE_URL}/public/reject-offer/${customer.accept_token}`;
  const { subject, html } = renderTemplate('offer_reminder', {
    name: customer.name || '', price: priceText, acceptUrl, modifyUrl, rejectUrl,
  });
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
  sendOfferReminder,
  sendOrderFormToColleague,
  sendFinalOrderFormToCustomer,
  sendAdvanceInvoice,
  sendInstalledNotice,
};
