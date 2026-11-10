package app.lumiether.payslip;

/** HTML in, PDF bytes out. The real one is {@link PdfClient}; tests pass a fake, as the Node tests did. */
@FunctionalInterface
public interface PayslipRenderer {
  byte[] render(String html);
}
